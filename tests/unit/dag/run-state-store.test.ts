import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  RunStateStore,
  GraphDriftError,
  UnsupportedSchemaVersionError
} from '../../../src/dag/run-state-store.ts';
import type { IRunStateStore } from '../../../src/dag/run-state-store.interface.ts';
import type { DagRunState } from '../../../src/dag/types.ts';

describe('RunStateStore', () => {
  let tempDir: string;
  let store: RunStateStore;

  const sampleState: DagRunState = {
    schemaVersion: '1.0.0',
    graphVersion: '1.0.0',
    graphHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    runId: 'run-2026-09-18-001',
    graphPath: 'task-graph.yaml',
    status: 'RUNNING',
    activeTaskIds: ['task-1'],
    startedAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:05:00.000Z',
    tasks: {
      'task-1': {
        taskId: 'task-1',
        status: 'RUNNING',
        retryCount: 0,
        baseCommit: 'commit-base-001'
      }
    }
  };

  const sampleYaml = `
version: "1.0.0"
project:
  name: "TestProject"
  targetScheme: "TestProject"
tasks:
  - id: "task-1"
    title: "Task 1"
    goal: "Goal 1"
    role: "Developer"
    dependencies: []
    allowed_files: []
    acceptance_criteria: []
    verification: {}
`;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'aire-run-state-test-'));
    store = new RunStateStore();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('computeGraphHash', () => {
    test('computes stable and accurate sha256 hex string', () => {
      const hash1 = store.computeGraphHash(sampleYaml);
      const hash2 = store.computeGraphHash(sampleYaml);
      const expected = createHash('sha256').update(sampleYaml).digest('hex');

      assert.equal(hash1, expected);
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64);
    });

    test('produces different hashes for modified yaml content', () => {
      const hash1 = store.computeGraphHash(sampleYaml);
      const modifiedYaml = sampleYaml + '\n# comment';
      const hash2 = store.computeGraphHash(modifiedYaml);

      assert.notEqual(hash1, hash2);
    });
  });

  describe('saveRunState', () => {
    test('writes state to .aire/run-state.json and creates .aire directory if needed', async () => {
      await store.saveRunState(tempDir, sampleState);

      const statePath = path.join(tempDir, '.aire', 'run-state.json');
      assert.ok(existsSync(statePath), 'run-state.json should exist');

      const raw = await fs.readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw) as DagRunState;
      assert.deepEqual(parsed, sampleState);
    });

    test('performs atomic write: uses .aire/run-state.json.tmp and cleans it up via rename', async () => {
      const tmpPath = path.join(tempDir, '.aire', 'run-state.json.tmp');
      const finalPath = path.join(tempDir, '.aire', 'run-state.json');

      await store.saveRunState(tempDir, sampleState);

      assert.ok(existsSync(finalPath), 'final run-state.json must exist');
      assert.ok(!existsSync(tmpPath), 'temporary file .tmp must NOT exist after atomic rename');
    });

    test('overwrites existing run-state.json atomically', async () => {
      await store.saveRunState(tempDir, sampleState);

      const updatedState: DagRunState = {
        ...sampleState,
        status: 'SUCCEEDED',
        updatedAt: '2026-09-18T10:10:00.000Z',
        activeTaskIds: []
      };

      await store.saveRunState(tempDir, updatedState);

      const loaded = await store.loadRunState(tempDir);
      assert.deepEqual(loaded, updatedState);
    });
  });

  describe('loadRunState & Schema Migration', () => {
    test('returns null when run-state.json does not exist', async () => {
      const result = await store.loadRunState(tempDir);
      assert.equal(result, null);
    });

    test('returns loaded state when valid 1.0.0 state exists', async () => {
      await store.saveRunState(tempDir, sampleState);
      const loaded = await store.loadRunState(tempDir);
      assert.deepEqual(loaded, sampleState);
    });

    test('accepts minor and patch version increments within major version 1', async () => {
      const v120State: DagRunState = {
        ...sampleState,
        schemaVersion: '1.2.0'
      };
      await store.saveRunState(tempDir, v120State);
      const loaded = await store.loadRunState(tempDir);
      assert.deepEqual(loaded, v120State);
    });

    test('throws UnsupportedSchemaVersionError when schemaVersion is higher than major 1 (e.g. 2.0.0)', async () => {
      const v200State = {
        ...sampleState,
        schemaVersion: '2.0.0'
      };
      const aireDir = path.join(tempDir, '.aire');
      await fs.mkdir(aireDir, { recursive: true });
      await fs.writeFile(
        path.join(aireDir, 'run-state.json'),
        JSON.stringify(v200State),
        'utf-8'
      );

      await assert.rejects(
        async () => {
          await store.loadRunState(tempDir);
        },
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedSchemaVersionError);
          assert.match((err as Error).message, /2\.0\.0/);
          return true;
        }
      );
    });

    test('throws UnsupportedSchemaVersionError when schemaVersion is missing or invalid', async () => {
      const invalidState = {
        ...sampleState,
        schemaVersion: undefined
      };
      const aireDir = path.join(tempDir, '.aire');
      await fs.mkdir(aireDir, { recursive: true });
      await fs.writeFile(
        path.join(aireDir, 'run-state.json'),
        JSON.stringify(invalidState),
        'utf-8'
      );

      await assert.rejects(
        async () => {
          await store.loadRunState(tempDir);
        },
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedSchemaVersionError);
          return true;
        }
      );
    });

    test('executes registered schema migration for older schema version (e.g. 0.9.0 -> 1.0.0)', async () => {
      const legacyState = {
        schemaVersion: '0.9.0',
        graphVersion: '1.0.0',
        graphHash: 'hash-001',
        runId: 'legacy-run',
        graphPath: 'task-graph.yaml',
        status: 'RUNNING',
        activeTaskIds: [],
        startedAt: '2026-09-18T09:00:00.000Z',
        updatedAt: '2026-09-18T09:00:00.000Z',
        tasks: {}
      };

      const aireDir = path.join(tempDir, '.aire');
      await fs.mkdir(aireDir, { recursive: true });
      await fs.writeFile(
        path.join(aireDir, 'run-state.json'),
        JSON.stringify(legacyState),
        'utf-8'
      );

      store.registerMigrator('0.9.0', (raw) => {
        return {
          ...raw,
          schemaVersion: '1.0.0',
          migratedFrom: '0.9.0'
        };
      });

      const loaded = await store.loadRunState(tempDir);
      assert.ok(loaded);
      assert.equal(loaded.schemaVersion, '1.0.0');
      assert.equal((loaded as any).migratedFrom, '0.9.0');
    });

    test('throws UnsupportedSchemaVersionError when legacy version has no migration registered', async () => {
      const legacyState = {
        ...sampleState,
        schemaVersion: '0.5.0'
      };
      const aireDir = path.join(tempDir, '.aire');
      await fs.mkdir(aireDir, { recursive: true });
      await fs.writeFile(
        path.join(aireDir, 'run-state.json'),
        JSON.stringify(legacyState),
        'utf-8'
      );

      await assert.rejects(
        async () => {
          await store.loadRunState(tempDir);
        },
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedSchemaVersionError);
          return true;
        }
      );
    });
  });

  describe('Graph Drift Detection & GraphDriftError', () => {
    test('GraphDriftError formats message and preserves expected and actual hashes', () => {
      const err = new GraphDriftError('expected-hash-123', 'actual-hash-456');
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'GraphDriftError');
      assert.equal(err.expectedHash, 'expected-hash-123');
      assert.equal(err.actualHash, 'actual-hash-456');
      assert.match(err.message, /expected-hash-123/);
      assert.match(err.message, /actual-hash-456/);
    });

    test('validateGraphHash succeeds when hash matches yaml content', () => {
      const hash = store.computeGraphHash(sampleYaml);
      assert.doesNotThrow(() => {
        store.validateGraphHash(hash, sampleYaml);
      });
    });

    test('validateGraphHash throws GraphDriftError when yaml content differs', () => {
      const hash = store.computeGraphHash(sampleYaml);
      const tamperedYaml = sampleYaml + '\n  - id: "injected-task"';

      assert.throws(
        () => {
          store.validateGraphHash(hash, tamperedYaml);
        },
        (err: unknown) => {
          assert.ok(err instanceof GraphDriftError);
          assert.equal((err as GraphDriftError).expectedHash, hash);
          assert.equal((err as GraphDriftError).actualHash, store.computeGraphHash(tamperedYaml));
          return true;
        }
      );
    });
  });
});
