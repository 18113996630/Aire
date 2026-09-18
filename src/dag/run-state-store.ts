/**
 * AIRE Global Run State Store Implementation
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Sections 2.2.4, 4.3, 4.4
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { DagRunState } from './types.ts';
import type { IRunStateStore } from './run-state-store.interface.ts';

export class GraphDriftError extends Error {
  readonly expectedHash?: string;
  readonly actualHash?: string;

  constructor(expectedOrMessage?: string, actualHash?: string) {
    if (actualHash !== undefined) {
      super(`Graph drift detected: expected hash ${expectedOrMessage}, got ${actualHash}`);
      this.expectedHash = expectedOrMessage;
      this.actualHash = actualHash;
    } else {
      super(expectedOrMessage ?? 'Graph drift detected: task graph hash does not match saved run state');
    }
    this.name = 'GraphDriftError';
  }
}

export class UnsupportedSchemaVersionError extends Error {
  readonly version?: string;

  constructor(versionOrMessage: string, detail?: string) {
    super(
      detail ?? (
        versionOrMessage.includes(' ')
          ? versionOrMessage
          : `Unsupported schema version: ${versionOrMessage}. Supported major version is 1.`
      )
    );
    this.name = 'UnsupportedSchemaVersionError';
    if (!versionOrMessage.includes(' ')) {
      this.version = versionOrMessage;
    }
  }
}

export type SchemaMigrator = (rawState: Record<string, unknown>) => Record<string, unknown>;

export class RunStateStore implements IRunStateStore {
  private migrators: Map<string, SchemaMigrator> = new Map();

  /**
   * Register a schema migration transformer for a specific legacy schema version.
   */
  registerMigrator(fromVersion: string, migrator: SchemaMigrator): void {
    this.migrators.set(fromVersion, migrator);
  }

  /**
   * Compute stable SHA-256 hex digest for raw YAML content.
   */
  computeGraphHash(rawYamlContent: string): string {
    return createHash('sha256').update(rawYamlContent).digest('hex');
  }

  /**
   * Save global DAG run state atomically:
   * 1. Ensure .aire directory exists.
   * 2. Write serialized JSON to .aire/run-state.json.tmp.
   * 3. Call fsync on file handle to ensure bytes are committed to persistent storage.
   * 4. Rename .aire/run-state.json.tmp to .aire/run-state.json atomically.
   */
  async saveRunState(projectPath: string, state: DagRunState): Promise<void> {
    const aireDir = path.join(projectPath, '.aire');
    await fs.mkdir(aireDir, { recursive: true });

    const tmpPath = path.join(aireDir, 'run-state.json.tmp');
    const targetPath = path.join(aireDir, 'run-state.json');

    const fileHandle = await fs.open(tmpPath, 'w');
    try {
      const content = JSON.stringify(state, null, 2);
      await fileHandle.writeFile(content, 'utf-8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    await fs.rename(tmpPath, targetPath);
  }

  /**
   * Load global DAG run state from .aire/run-state.json:
   * - Returns null if file does not exist.
   * - Parses JSON content.
   * - Validates schemaVersion (supports 1.x.x).
   * - Applies registered schema migrators if applicable.
   * - Throws UnsupportedSchemaVersionError if version is > 1 or unsupported.
   */
  async loadRunState(projectPath: string): Promise<DagRunState | null> {
    const statePath = path.join(projectPath, '.aire', 'run-state.json');

    let rawContent: string;
    try {
      rawContent = await fs.readFile(statePath, 'utf-8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseError: any) {
      throw new Error(`Corrupted run state at ${statePath}: ${parseError.message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new UnsupportedSchemaVersionError('unknown', 'Invalid run state payload');
    }

    const schemaVersion = (parsed as any).schemaVersion;
    if (typeof schemaVersion !== 'string' || !schemaVersion.trim()) {
      throw new UnsupportedSchemaVersionError('unknown', 'Missing or invalid schemaVersion in run state');
    }

    // Apply registered migrators if present
    let currentVersion = schemaVersion;
    while (this.migrators.has(currentVersion)) {
      const migrator = this.migrators.get(currentVersion)!;
      parsed = migrator(parsed);
      currentVersion = (parsed as any).schemaVersion as string;
    }

    const versionMatch = /^(\d+)/.exec(currentVersion);
    if (!versionMatch) {
      throw new UnsupportedSchemaVersionError(currentVersion, `Invalid schemaVersion format: ${currentVersion}`);
    }

    const major = parseInt(versionMatch[1], 10);
    if (major > 1) {
      throw new UnsupportedSchemaVersionError(
        currentVersion,
        `Unsupported schema version '${currentVersion}': major version ${major} is greater than supported version 1`
      );
    }

    if (major < 1) {
      throw new UnsupportedSchemaVersionError(
        currentVersion,
        `Unsupported schema version '${currentVersion}': no migration available to version 1.x`
      );
    }

    return parsed as unknown as DagRunState;
  }

  /**
   * Validate graph hash against raw YAML content. Throws GraphDriftError if mismatched.
   */
  validateGraphHash(savedHash: string, rawYamlContent: string): void {
    const currentHash = this.computeGraphHash(rawYamlContent);
    if (savedHash !== currentHash) {
      throw new GraphDriftError(savedHash, currentHash);
    }
  }
}
