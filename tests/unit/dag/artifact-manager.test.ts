import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArtifactManager } from '../../../src/dag/artifact-manager.ts';
import type { IArtifactManager } from '../../../src/dag/artifact-manager.interface.ts';
import type { TaskNode, TaskResult } from '../../../src/dag/types.ts';

describe('ArtifactManager', () => {
  let tempDir: string;
  let artifactManager: IArtifactManager;

  const sampleTask: TaskNode = {
    id: 'task-data-models',
    title: 'Data Models',
    goal: 'Define SwiftData schemas and persistence stack',
    role: 'Architect',
    dependencies: [],
    dependents: ['task-list-ui'],
    allowed_files: ['Models/Item.swift'],
    acceptance_criteria: ['Models compile without error'],
    verification: { build: true }
  };

  const sampleResult: TaskResult = {
    taskId: 'task-data-models',
    title: 'Data Models',
    goal: 'Define SwiftData schemas and persistence stack',
    status: 'SUCCEEDED',
    summary: 'Created Item model and registered SwiftData container',
    changedFiles: ['Models/Item.swift', 'App/AppSchema.swift'],
    artifacts: ['docs/models.md'],
    apiContracts: ['Item', 'ItemSchemaVersion'],
    baseCommit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    commit: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    completedAt: '2026-09-18T10:00:00.000Z'
  };

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'aire-artifact-test-'));
    artifactManager = new ArtifactManager();
  });

  afterEach(async () => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('saveTaskResult & getTaskResult', () => {
    test('saves task result to .aire/tasks/<taskId>/result.json creating dirs recursively', async () => {
      await artifactManager.saveTaskResult(tempDir, sampleResult);

      const targetPath = path.join(tempDir, '.aire', 'tasks', sampleResult.taskId, 'result.json');
      const rawContent = await fs.readFile(targetPath, 'utf-8');
      const parsed = JSON.parse(rawContent) as TaskResult;

      assert.deepEqual(parsed, sampleResult);
    });

    test('getTaskResult reads saved result correctly', async () => {
      await artifactManager.saveTaskResult(tempDir, sampleResult);

      const loaded = await artifactManager.getTaskResult(tempDir, sampleResult.taskId);
      assert.notEqual(loaded, null);
      assert.deepEqual(loaded, sampleResult);
    });

    test('getTaskResult returns null when result.json does not exist (ENOENT)', async () => {
      const result = await artifactManager.getTaskResult(tempDir, 'non-existent-task');
      assert.equal(result, null);
    });

    test('getTaskResult returns null when result.json is invalid/corrupted', async () => {
      const taskDir = path.join(tempDir, '.aire', 'tasks', 'corrupted-task');
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, 'result.json'), '{ invalid json content ...', 'utf-8');

      const result = await artifactManager.getTaskResult(tempDir, 'corrupted-task');
      assert.equal(result, null);
    });
  });

  describe('getDirectDependencyResults', () => {
    test('returns empty array when dependencyIds is empty', async () => {
      const results = await artifactManager.getDirectDependencyResults(tempDir, []);
      assert.deepEqual(results, []);
    });

    test('returns array of existing dependency results in order', async () => {
      const result1: TaskResult = {
        ...sampleResult,
        taskId: 'task-1',
        title: 'Task 1'
      };
      const result2: TaskResult = {
        ...sampleResult,
        taskId: 'task-2',
        title: 'Task 2'
      };

      await artifactManager.saveTaskResult(tempDir, result1);
      await artifactManager.saveTaskResult(tempDir, result2);

      const retrieved = await artifactManager.getDirectDependencyResults(tempDir, ['task-1', 'task-2']);
      assert.equal(retrieved.length, 2);
      assert.equal(retrieved[0].taskId, 'task-1');
      assert.equal(retrieved[1].taskId, 'task-2');
    });

    test('ignores missing dependency results and returns only existing ones', async () => {
      const result1: TaskResult = {
        ...sampleResult,
        taskId: 'task-existing',
        title: 'Task Existing'
      };

      await artifactManager.saveTaskResult(tempDir, result1);

      const retrieved = await artifactManager.getDirectDependencyResults(tempDir, [
        'task-missing-1',
        'task-existing',
        'task-missing-2'
      ]);

      assert.equal(retrieved.length, 1);
      assert.equal(retrieved[0].taskId, 'task-existing');
    });

    test('returns empty array when none of the requested dependencies exist', async () => {
      const retrieved = await artifactManager.getDirectDependencyResults(tempDir, ['dep-a', 'dep-b']);
      assert.deepEqual(retrieved, []);
    });
  });

  describe('reconstructTaskResult', () => {
    test('reconstructs valid TaskResult conforming to contracts and persists it', async () => {
      const baseCommit = '1111111111111111111111111111111111111111';
      const commit = '2222222222222222222222222222222222222222';
      const changedFiles = ['Models/Item.swift', 'Models/ItemSchema.swift'];

      const reconstructed = await artifactManager.reconstructTaskResult(
        tempDir,
        sampleTask,
        baseCommit,
        commit,
        changedFiles
      );

      assert.equal(reconstructed.taskId, sampleTask.id);
      assert.equal(reconstructed.title, sampleTask.title);
      assert.equal(reconstructed.goal, sampleTask.goal);
      assert.equal(reconstructed.status, 'SUCCEEDED');
      assert.ok(reconstructed.summary.length > 0);
      assert.deepEqual(reconstructed.changedFiles, changedFiles);
      assert.deepEqual(reconstructed.artifacts, []);
      assert.deepEqual(reconstructed.apiContracts, []);
      assert.equal(reconstructed.baseCommit, baseCommit);
      assert.equal(reconstructed.commit, commit);
      assert.ok(!isNaN(Date.parse(reconstructed.completedAt)));

      // Verify file was persisted to .aire/tasks/<taskId>/result.json
      const loaded = await artifactManager.getTaskResult(tempDir, sampleTask.id);
      assert.notEqual(loaded, null);
      assert.deepEqual(loaded, reconstructed);
    });

    test('is idempotent when called multiple times', async () => {
      const baseCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const changedFiles = ['Views/ListView.swift'];

      const res1 = await artifactManager.reconstructTaskResult(
        tempDir,
        sampleTask,
        baseCommit,
        commit,
        changedFiles
      );

      const res2 = await artifactManager.reconstructTaskResult(
        tempDir,
        sampleTask,
        baseCommit,
        commit,
        changedFiles
      );

      assert.equal(res1.taskId, res2.taskId);
      assert.equal(res1.commit, res2.commit);
      assert.equal(res1.baseCommit, res2.baseCommit);
      assert.deepEqual(res1.changedFiles, res2.changedFiles);

      const finalLoaded = await artifactManager.getTaskResult(tempDir, sampleTask.id);
      assert.deepEqual(finalLoaded, res2);
    });
  });
});
