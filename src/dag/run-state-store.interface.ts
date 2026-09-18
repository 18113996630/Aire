/**
 * AIRE Global Run State Store Interface
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 2.2.4
 */

import type { DagRunState } from './types.ts';

export interface IRunStateStore {
  /**
   * Save global DAG run state to .aire/run-state.json atomically
   * (temp file write -> fsync -> rename)
   */
  saveRunState(projectPath: string, state: DagRunState): Promise<void>;

  /**
   * Load global DAG run state from .aire/run-state.json, or null if not found.
   * Performs schemaVersion validation and schema migration.
   */
  loadRunState(projectPath: string): Promise<DagRunState | null>;

  /**
   * Compute stable SHA-256 hash of task-graph.yaml raw content
   */
  computeGraphHash(rawYamlContent: string): string;
}
