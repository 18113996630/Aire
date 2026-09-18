/**
 * AIRE Layer 2 Integration Test: Crash Recovery (3 Scenarios)
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Sections 4.4 & 6.2
 *
 * Validates all 3 crash recovery scenarios in real Git test repository:
 * - Scenario 1 (Pre-commit crash):
 *     Interrupted while RUNNING, HEAD === baseCommit.
 *     Resume rolls back dirty untracked/modified files, resets task to PENDING, and runs to success.
 * - Scenario 2 (Post-commit crash before RunState update):
 *     Interrupted after commit, HEAD !== baseCommit, commit has valid AIRE trailers.
 *     Resume verifies trailers via Git, reconstructs TaskResult, calibrates task to SUCCEEDED,
 *     and finishes remaining DAG tasks without duplicate execution.
 *   - Also tests rogue commit without matching trailers throwing WorkspaceInconsistentError.
 * - Scenario 3 (RunState SUCCEEDED but TaskResult missing):
 *     RunState shows task SUCCEEDED, but .aire/tasks/<id>/result.json was deleted/missing.
 *     Resume reconciles and idempotently reconstructs the missing TaskResult,
 *     and downstream task successfully consumes it.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  SerialDagScheduler,
  WorkspaceInconsistentError,
} from '../../src/dag/serial-dag-scheduler.ts';
import { TaskGraph } from '../../src/dag/task-graph.ts';
import { TaskRunner } from '../../src/dag/task-runner.ts';
import { SerialWorkspaceStrategy } from '../../src/dag/serial-workspace-strategy.ts';
import { RunStateStore } from '../../src/dag/run-state-store.ts';
import { ArtifactManager } from '../../src/dag/artifact-manager.ts';
import { CascadeExecutionPolicy } from '../../src/dag/cascade-execution-policy.ts';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from '../../src/runtime/adapter.interface.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';
import type { DagRunState } from '../../src/dag/types.ts';

const execFileAsync = promisify(execFile);

describe('Layer 2 Integration: Crash Recovery Matrix (3 Scenarios)', () => {
  let testRepoDir: string;

  async function runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: testRepoDir });
    return stdout.trim();
  }

  const linearYaml = `
version: "1.0.0"
project:
  name: "RecoveryApp"
  targetScheme: "RecoveryApp"
tasks:
  - id: "task-a"
    title: "Setup Core Model A"
    goal: "Implement ModelA entity"
    role: "iOS Developer"
    dependencies: []
    allowed_files: ["Sources/ModelA.swift"]
    acceptance_criteria: ["ModelA compiles cleanly"]
  - id: "task-b"
    title: "Setup Service B"
    goal: "Implement ServiceB relying on ModelA"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["Sources/ServiceB.swift"]
    acceptance_criteria: ["ServiceB compiles cleanly"]
`;

  beforeEach(async () => {
    testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-int-recovery-'));
    await runGit(['init', '-b', 'main']);
    await runGit(['config', 'user.name', 'Aire Tester']);
    await runGit(['config', 'user.email', 'tester@aire.local']);
    await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Recovery App\n', 'utf-8');
    await fs.writeFile(path.join(testRepoDir, '.gitignore'), '.aire/\n', 'utf-8');
    await fs.writeFile(path.join(testRepoDir, 'task-graph.yaml'), linearYaml, 'utf-8');
    await runGit(['add', '.']);
    await runGit(['commit', '-m', 'chore: initial repository structure']);
  });

  afterEach(async () => {
    await fs.rm(testRepoDir, { recursive: true, force: true });
  });

  function createTestCli(executedTasks: string[], promptsReceived: Map<string, string>): ICliAdapter {
    return {
      name: 'RecoveryMockCli',
      async isAvailable() {
        return true;
      },
      async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
        const taskIdMatch = params.prompt.match(/- \*\*任务 ID\*\*: `([^`]+)`/);
        const taskId = taskIdMatch ? taskIdMatch[1] : 'unknown';
        executedTasks.push(taskId);
        promptsReceived.set(taskId, params.prompt);

        const allowedFilesSection = params.prompt.match(
          /- \*\*允许修改的文件清单（Allowed Files）\*\*:\n((?:\s+- `[^`]+`\n?)+)/
        );
        if (allowedFilesSection) {
          const files = [...allowedFilesSection[1].matchAll(/- `([^`]+)`/g)].map((m) => m[1]);
          for (const relFile of files) {
            if (relFile === '(无限制)') continue;
            const fullPath = path.join(params.cwd, relFile);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(
              fullPath,
              `// Implementation for ${taskId} in ${relFile}\npublic struct Entity_${taskId.replace(/-/g, '_')} {}\n`,
              'utf-8'
            );
          }
        }

        return {
          exitCode: 0,
          stdout: `Generated code for ${taskId}`,
          stderr: '',
          durationMs: 5,
        };
      },
    };
  }

  const mockEvaluatorFactory = (task: { id: string }): IEvaluator => ({
    name: 'MockBuildEvaluator',
    evaluate: async () => ({
      passed: true,
      type: 'BUILD',
      summary: `Build passed for ${task.id}`,
      errors: [],
    }),
  });

  test('Scenario 1 (Pre-commit crash): rolls back uncommitted dirty files, resets task to PENDING, and runs to success', async () => {
    const executedTasks: string[] = [];
    const promptsReceived = new Map<string, string>();
    const runStateStore = new RunStateStore();
    const artifactManager = new ArtifactManager();
    const workspaceStrategy = new SerialWorkspaceStrategy();
    const executionPolicy = new CascadeExecutionPolicy();

    const initialSha = await runGit(['rev-parse', 'HEAD']);
    const graphHash = runStateStore.computeGraphHash(linearYaml);
    const runId = 'crash-run-scenario-1';

    // Simulate crash state: task-a was RUNNING at baseCommit initialSha, activeTaskIds = ['task-a']
    const interruptedState: DagRunState = {
      schemaVersion: '1.0.0',
      graphVersion: '1.0.0',
      graphHash,
      runId,
      graphPath: 'task-graph.yaml',
      status: 'RUNNING',
      activeTaskIds: ['task-a'],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: {
        'task-a': {
          taskId: 'task-a',
          status: 'RUNNING',
          retryCount: 0,
          baseCommit: initialSha,
        },
        'task-b': {
          taskId: 'task-b',
          status: 'PENDING',
          retryCount: 0,
        },
      },
    };
    await runStateStore.saveRunState(testRepoDir, interruptedState);

    // Inject dirty working tree files: untracked file & half-written modified file
    const dirtyFile = path.join(testRepoDir, 'Sources/ModelA_uncommitted.tmp');
    await fs.mkdir(path.dirname(dirtyFile), { recursive: true });
    await fs.writeFile(dirtyFile, '// Half-baked uncommitted work\n', 'utf-8');

    // Confirm HEAD === baseCommit before resume
    const headBeforeResume = await runGit(['rev-parse', 'HEAD']);
    assert.equal(headBeforeResume, initialSha);

    const taskRunner = new TaskRunner({
      cliAdapter: createTestCli(executedTasks, promptsReceived),
      evaluatorFactory: mockEvaluatorFactory,
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      executionPolicy,
      artifactManager,
      runStateStore,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    // Resume execution
    const report = await scheduler.resume(testRepoDir);

    // 1. Overall report status
    assert.equal(report.status, 'SUCCEEDED');
    assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);
    assert.equal(report.failedTasks.length, 0);

    // 2. Both tasks were executed cleanly
    assert.ok(executedTasks.includes('task-a'));
    assert.ok(executedTasks.includes('task-b'));

    // 3. Dirty uncommitted file was cleaned during calibration
    const dirtyFileExists = await fs
      .access(dirtyFile)
      .then(() => true)
      .catch(() => false);
    assert.equal(dirtyFileExists, false, 'Uncommitted dirty file should have been cleaned by rollback');

    // 4. Valid commits with trailers exist for both tasks
    for (const taskId of ['task-a', 'task-b']) {
      const res = await artifactManager.getTaskResult(testRepoDir, taskId);
      assert.ok(res);
      assert.equal(res.status, 'SUCCEEDED');

      const trailerTaskId = await runGit([
        'log',
        '-1',
        '--format=%(trailers:key=AIRE-Task-Id,valueonly)',
        res.commit,
      ]);
      assert.equal(trailerTaskId, taskId);

      const trailerRunId = await runGit([
        'log',
        '-1',
        '--format=%(trailers:key=AIRE-Run-Id,valueonly)',
        res.commit,
      ]);
      assert.equal(trailerRunId, runId);
    }

    // 5. Working tree is clean
    const statusOutput = await runGit(['status', '--porcelain']);
    assert.equal(statusOutput, '', 'Working tree should be clean');
  });

  test('Scenario 2 (Post-commit crash before RunState update): verifies Git trailers, reconstructs TaskResult, calibrates task-a to SUCCEEDED, and finishes remaining DAG tasks', async () => {
    const executedTasks: string[] = [];
    const promptsReceived = new Map<string, string>();
    const runStateStore = new RunStateStore();
    const artifactManager = new ArtifactManager();
    const workspaceStrategy = new SerialWorkspaceStrategy();
    const executionPolicy = new CascadeExecutionPolicy();

    const initialSha = await runGit(['rev-parse', 'HEAD']);
    const graphHash = runStateStore.computeGraphHash(linearYaml);
    const runId = 'crash-run-scenario-2';

    // Commit task-a into git with proper AIRE trailers to simulate post-commit crash
    const modelAFile = path.join(testRepoDir, 'Sources/ModelA.swift');
    await fs.mkdir(path.dirname(modelAFile), { recursive: true });
    await fs.writeFile(modelAFile, 'public struct ModelA {}\n', 'utf-8');

    const commitA = await workspaceStrategy.commitTaskWorkspace(
      {
        projectPath: testRepoDir,
        taskId: 'task-a',
        runId,
        allowedFiles: ['Sources/ModelA.swift'],
      },
      {
        runId,
        taskId: 'task-a',
        baseCommit: initialSha,
        title: 'Setup Core Model A',
      }
    );

    // Verify HEAD !== baseCommit
    const currentHead = await runGit(['rev-parse', 'HEAD']);
    assert.equal(currentHead, commitA);
    assert.notEqual(currentHead, initialSha);

    // RunState still has task-a as RUNNING with activeTaskIds = ['task-a']
    const interruptedState: DagRunState = {
      schemaVersion: '1.0.0',
      graphVersion: '1.0.0',
      graphHash,
      runId,
      graphPath: 'task-graph.yaml',
      status: 'RUNNING',
      activeTaskIds: ['task-a'],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: {
        'task-a': {
          taskId: 'task-a',
          status: 'RUNNING',
          retryCount: 0,
          baseCommit: initialSha,
        },
        'task-b': {
          taskId: 'task-b',
          status: 'PENDING',
          retryCount: 0,
        },
      },
    };
    await runStateStore.saveRunState(testRepoDir, interruptedState);

    // Make sure result.json for task-a was NOT saved (simulate crash right before artifact save)
    const initialResultA = await artifactManager.getTaskResult(testRepoDir, 'task-a');
    assert.equal(initialResultA, null, 'Task A result.json should not exist initially');

    const taskRunner = new TaskRunner({
      cliAdapter: createTestCli(executedTasks, promptsReceived),
      evaluatorFactory: mockEvaluatorFactory,
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      executionPolicy,
      artifactManager,
      runStateStore,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    // Resume execution
    const report = await scheduler.resume(testRepoDir);

    // 1. Overall report status
    assert.equal(report.status, 'SUCCEEDED');
    assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);

    // 2. CRUCIAL: task-a was NOT executed again by TaskRunner! Only task-b ran.
    assert.deepEqual(executedTasks, ['task-b'], 'Task A should NOT be re-executed since commit was verified');

    // 3. Task A's TaskResult was reconstructed and saved to disk
    const reconciledResultA = await artifactManager.getTaskResult(testRepoDir, 'task-a');
    assert.ok(reconciledResultA);
    assert.equal(reconciledResultA.taskId, 'task-a');
    assert.equal(reconciledResultA.status, 'SUCCEEDED');
    assert.equal(reconciledResultA.commit, commitA);
    assert.equal(reconciledResultA.baseCommit, initialSha);
    assert.deepEqual(reconciledResultA.changedFiles, ['Sources/ModelA.swift']);

    // 4. Downstream task-b received task-a's direct dependency contract in its prompt
    const taskBPrompt = promptsReceived.get('task-b');
    assert.ok(taskBPrompt);
    assert.ok(taskBPrompt.includes('### 依赖任务: [task-a]'));
    assert.ok(taskBPrompt.includes(commitA));
    assert.ok(taskBPrompt.includes('Sources/ModelA.swift'));

    // 5. Working tree is clean
    const statusOutput = await runGit(['status', '--porcelain']);
    assert.equal(statusOutput, '', 'Working tree should be clean');
  });

  test('Scenario 2 (Negative case): post-commit crash with unmatching trailers throws WorkspaceInconsistentError', async () => {
    const executedTasks: string[] = [];
    const promptsReceived = new Map<string, string>();
    const runStateStore = new RunStateStore();
    const artifactManager = new ArtifactManager();
    const workspaceStrategy = new SerialWorkspaceStrategy();
    const executionPolicy = new CascadeExecutionPolicy();

    const initialSha = await runGit(['rev-parse', 'HEAD']);
    const graphHash = runStateStore.computeGraphHash(linearYaml);
    const runId = 'crash-run-scenario-2-neg';

    // Commit an external rogue commit that DOES NOT have standard AIRE trailers
    await fs.writeFile(path.join(testRepoDir, 'Rogue.swift'), '// Rogue change\n', 'utf-8');
    await runGit(['add', '.']);
    await runGit(['commit', '-m', 'chore: rogue commit from foreign developer']);

    const rogueSha = await runGit(['rev-parse', 'HEAD']);
    assert.notEqual(rogueSha, initialSha);

    // RunState expects task-a with baseCommit = initialSha
    const interruptedState: DagRunState = {
      schemaVersion: '1.0.0',
      graphVersion: '1.0.0',
      graphHash,
      runId,
      graphPath: 'task-graph.yaml',
      status: 'RUNNING',
      activeTaskIds: ['task-a'],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: {
        'task-a': {
          taskId: 'task-a',
          status: 'RUNNING',
          retryCount: 0,
          baseCommit: initialSha,
        },
        'task-b': {
          taskId: 'task-b',
          status: 'PENDING',
          retryCount: 0,
        },
      },
    };
    await runStateStore.saveRunState(testRepoDir, interruptedState);

    const taskRunner = new TaskRunner({
      cliAdapter: createTestCli(executedTasks, promptsReceived),
      evaluatorFactory: mockEvaluatorFactory,
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      executionPolicy,
      artifactManager,
      runStateStore,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    // Resume should throw WorkspaceInconsistentError to protect workspace
    await assert.rejects(
      async () => {
        await scheduler.resume(testRepoDir);
      },
      (err: any) => {
        assert.ok(err instanceof WorkspaceInconsistentError);
        assert.match(err.message, /does not belong to active task task-a/);
        return true;
      }
    );
  });

  test('Scenario 3 (RunState SUCCEEDED but TaskResult missing): idempotently reconstructs missing result.json and downstream task consumes it', async () => {
    const executedTasks: string[] = [];
    const promptsReceived = new Map<string, string>();
    const runStateStore = new RunStateStore();
    const artifactManager = new ArtifactManager();
    const workspaceStrategy = new SerialWorkspaceStrategy();
    const executionPolicy = new CascadeExecutionPolicy();

    const initialSha = await runGit(['rev-parse', 'HEAD']);
    const graphHash = runStateStore.computeGraphHash(linearYaml);
    const runId = 'crash-run-scenario-3';

    // Commit task-a properly
    const modelAFile = path.join(testRepoDir, 'Sources/ModelA.swift');
    await fs.mkdir(path.dirname(modelAFile), { recursive: true });
    await fs.writeFile(modelAFile, 'public struct ModelA {}\n', 'utf-8');

    const commitA = await workspaceStrategy.commitTaskWorkspace(
      {
        projectPath: testRepoDir,
        taskId: 'task-a',
        runId,
        allowedFiles: ['Sources/ModelA.swift'],
      },
      {
        runId,
        taskId: 'task-a',
        baseCommit: initialSha,
        title: 'Setup Core Model A',
      }
    );

    // Set RunState to show task-a SUCCEEDED, but NO activeTaskIds
    const runState: DagRunState = {
      schemaVersion: '1.0.0',
      graphVersion: '1.0.0',
      graphHash,
      runId,
      graphPath: 'task-graph.yaml',
      status: 'HALTED',
      activeTaskIds: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: {
        'task-a': {
          taskId: 'task-a',
          status: 'SUCCEEDED',
          retryCount: 0,
          baseCommit: initialSha,
          commit: commitA,
        },
        'task-b': {
          taskId: 'task-b',
          status: 'PENDING',
          retryCount: 0,
        },
      },
    };
    await runStateStore.saveRunState(testRepoDir, runState);

    // Explicitly verify result.json for task-a does NOT exist (e.g. lost or deleted)
    const resultBeforeResume = await artifactManager.getTaskResult(testRepoDir, 'task-a');
    assert.equal(resultBeforeResume, null);

    const taskRunner = new TaskRunner({
      cliAdapter: createTestCli(executedTasks, promptsReceived),
      evaluatorFactory: mockEvaluatorFactory,
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      executionPolicy,
      artifactManager,
      runStateStore,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    // Resume execution
    const report = await scheduler.resume(testRepoDir);

    // 1. Overall report status
    assert.equal(report.status, 'SUCCEEDED');
    assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);

    // 2. TaskResult for task-a was reconstructed and saved
    const reconstructedResultA = await artifactManager.getTaskResult(testRepoDir, 'task-a');
    assert.ok(reconstructedResultA);
    assert.equal(reconstructedResultA.status, 'SUCCEEDED');
    assert.equal(reconstructedResultA.commit, commitA);
    assert.equal(reconstructedResultA.baseCommit, initialSha);
    assert.deepEqual(reconstructedResultA.changedFiles, ['Sources/ModelA.swift']);

    // 3. Task B was executed and its prompt received the reconstructed contract of task-a
    assert.deepEqual(executedTasks, ['task-b']);
    const taskBPrompt = promptsReceived.get('task-b');
    assert.ok(taskBPrompt);
    assert.ok(taskBPrompt.includes('### 依赖任务: [task-a]'));
    assert.ok(taskBPrompt.includes(commitA));
    assert.ok(taskBPrompt.includes('Sources/ModelA.swift'));

    // 4. Task B's own result is also persisted
    const resultB = await artifactManager.getTaskResult(testRepoDir, 'task-b');
    assert.ok(resultB);
    assert.equal(resultB.status, 'SUCCEEDED');

    // 5. Working tree is clean
    const statusOutput = await runGit(['status', '--porcelain']);
    assert.equal(statusOutput, '', 'Working tree should be clean');
  });
});
