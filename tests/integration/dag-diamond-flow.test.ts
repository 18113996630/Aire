/**
 * AIRE Layer 2 Integration Test: Diamond DAG Flow
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 6.2
 *
 * Validates diamond DAG topology (A -> B, A -> C, B & C -> D):
 * - A completes first
 * - B and C execute in parallel/serial order after A
 * - D executes only after both B and C finish
 * - All tasks commit changes with AIRE Git Trailers
 * - TaskResult is persisted to .aire/tasks/<id>/result.json
 * - Overall DAG execution report status is SUCCEEDED (not HALTED)
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SerialDagScheduler } from '../../src/dag/serial-dag-scheduler.ts';
import { TaskGraph } from '../../src/dag/task-graph.ts';
import { TaskRunner } from '../../src/dag/task-runner.ts';
import { SerialWorkspaceStrategy } from '../../src/dag/serial-workspace-strategy.ts';
import { RunStateStore } from '../../src/dag/run-state-store.ts';
import { ArtifactManager } from '../../src/dag/artifact-manager.ts';
import { CascadeExecutionPolicy } from '../../src/dag/cascade-execution-policy.ts';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from '../../src/runtime/adapter.interface.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';

const execFileAsync = promisify(execFile);

describe('Layer 2 Integration: Diamond DAG Flow', () => {
  let testRepoDir: string;

  async function runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: testRepoDir });
    return stdout.trim();
  }

  const diamondYaml = `
version: "1.0.0"
project:
  name: "DiamondApp"
  targetScheme: "DiamondApp"
tasks:
  - id: "task-a"
    title: "Setup Data Models"
    goal: "Define shared domain entities"
    role: "iOS Developer"
    dependencies: []
    allowed_files: ["Sources/Models/User.swift"]
    acceptance_criteria: ["User model compiles cleanly"]
  - id: "task-b"
    title: "Setup Auth Service"
    goal: "Implement authentication service relying on User model"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["Sources/Services/AuthService.swift"]
    acceptance_criteria: ["AuthService compiles cleanly"]
  - id: "task-c"
    title: "Setup Feed Service"
    goal: "Implement user feed service relying on User model"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["Sources/Services/FeedService.swift"]
    acceptance_criteria: ["FeedService compiles cleanly"]
  - id: "task-d"
    title: "Setup Main Dashboard View"
    goal: "Assemble AuthService and FeedService into SwiftUI dashboard"
    role: "iOS Developer"
    dependencies: ["task-b", "task-c"]
    allowed_files: ["Sources/Views/DashboardView.swift"]
    acceptance_criteria: ["DashboardView compiles cleanly"]
`;

  beforeEach(async () => {
    testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-int-diamond-'));
    await runGit(['init', '-b', 'main']);
    await runGit(['config', 'user.name', 'Aire Tester']);
    await runGit(['config', 'user.email', 'tester@aire.local']);
    await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Diamond App\n', 'utf-8');
    await fs.writeFile(path.join(testRepoDir, '.gitignore'), '.aire/\n', 'utf-8');
    await runGit(['add', '.']);
    await runGit(['commit', '-m', 'chore: initial repository structure']);
  });

  afterEach(async () => {
    await fs.rm(testRepoDir, { recursive: true, force: true });
  });

  test('executes diamond DAG: A -> B, A -> C, B & C -> D, producing verified commits and result artifacts', async () => {
    const executionOrder: string[] = [];

    // Mock CLI adapter that writes the declared allowed_files into the repo
    const mockCli: ICliAdapter = {
      name: 'DiamondMockCli',
      async isAvailable() {
        return true;
      },
      async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
        const taskIdMatch = params.prompt.match(/- \*\*任务 ID\*\*: `([^`]+)`/);
        const taskId = taskIdMatch ? taskIdMatch[1] : 'unknown';
        executionOrder.push(taskId);

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
              `// Auto-generated code for ${taskId}\npublic struct Component_${taskId.replace(/-/g, '_')} {}\n`,
              'utf-8'
            );
          }
        }

        return {
          exitCode: 0,
          stdout: `Generated code for ${taskId}`,
          stderr: '',
          durationMs: 10,
        };
      },
    };

    const mockEvaluatorFactory = (task: { id: string }): IEvaluator => ({
      name: 'MockBuildEvaluator',
      evaluate: async () => ({
        passed: true,
        type: 'BUILD',
        summary: `Build passed for ${task.id}`,
        errors: [],
      }),
    });

    const workspaceStrategy = new SerialWorkspaceStrategy();
    const runStateStore = new RunStateStore();
    const artifactManager = new ArtifactManager();
    const executionPolicy = new CascadeExecutionPolicy();
    const taskRunner = new TaskRunner({
      cliAdapter: mockCli,
      evaluatorFactory: mockEvaluatorFactory,
    });

    const graph = TaskGraph.fromYaml(diamondYaml);
    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      executionPolicy,
      artifactManager,
      runStateStore,
      taskRunner,
      rawYamlContent: diamondYaml,
    });

    // Run DAG
    const report = await scheduler.run(graph, { projectPath: testRepoDir });

    // 1. Assert overall execution status
    assert.equal(report.status, 'SUCCEEDED');
    assert.equal(report.failedTasks.length, 0);
    assert.equal(report.blockedTasks.length, 0);
    assert.equal(report.completedTasks.length, 4);

    // 2. Assert topological execution ordering:
    // A must be first
    assert.equal(executionOrder[0], 'task-a');
    // B and C must execute after A and before D
    const bIndex = executionOrder.indexOf('task-b');
    const cIndex = executionOrder.indexOf('task-c');
    const dIndex = executionOrder.indexOf('task-d');
    assert.ok(bIndex > 0 && bIndex < 3, 'task-b should execute after task-a and before task-d');
    assert.ok(cIndex > 0 && cIndex < 3, 'task-c should execute after task-a and before task-d');
    // D must execute strictly after both B and C
    assert.equal(dIndex, 3, 'task-d should execute last');

    // 3. Assert RunState persisted in .aire/run-state.json
    const persistedState = await runStateStore.loadRunState(testRepoDir);
    assert.ok(persistedState);
    assert.equal(persistedState.status, 'SUCCEEDED');
    assert.deepEqual(persistedState.activeTaskIds, []);
    assert.equal(persistedState.tasks['task-a'].status, 'SUCCEEDED');
    assert.equal(persistedState.tasks['task-b'].status, 'SUCCEEDED');
    assert.equal(persistedState.tasks['task-c'].status, 'SUCCEEDED');
    assert.equal(persistedState.tasks['task-d'].status, 'SUCCEEDED');

    // 4. Assert each task generated a Git commit with AIRE trailers and result artifact
    const taskIds = ['task-a', 'task-b', 'task-c', 'task-d'];
    for (const taskId of taskIds) {
      // Check result.json
      const result = await artifactManager.getTaskResult(testRepoDir, taskId);
      assert.ok(result, `Expected result.json for ${taskId}`);
      assert.equal(result.taskId, taskId);
      assert.equal(result.status, 'SUCCEEDED');
      assert.ok(result.commit, `Expected commit sha for ${taskId}`);
      assert.ok(result.baseCommit, `Expected baseCommit sha for ${taskId}`);
      assert.notEqual(result.commit, result.baseCommit);
      assert.ok(result.changedFiles.length > 0, `Expected changedFiles for ${taskId}`);

      // Verify Git commit trailers on the committed SHA
      const commitSha = result.commit;
      const logSubject = await runGit(['log', '-1', '--format=%s', commitSha]);
      assert.ok(
        logSubject.startsWith(`feat(${taskId}):`),
        `Expected commit subject to start with feat(${taskId}), got: ${logSubject}`
      );

      const taskTrailer = await runGit([
        'log',
        '-1',
        '--format=%(trailers:key=AIRE-Task-Id,valueonly)',
        commitSha,
      ]);
      assert.equal(taskTrailer, taskId, `Trailer AIRE-Task-Id mismatch for ${taskId}`);

      const runTrailer = await runGit([
        'log',
        '-1',
        '--format=%(trailers:key=AIRE-Run-Id,valueonly)',
        commitSha,
      ]);
      assert.equal(runTrailer, report.runId, `Trailer AIRE-Run-Id mismatch for ${taskId}`);

      const baseCommitTrailer = await runGit([
        'log',
        '-1',
        '--format=%(trailers:key=AIRE-Base-Commit,valueonly)',
        commitSha,
      ]);
      assert.equal(
        baseCommitTrailer,
        result.baseCommit,
        `Trailer AIRE-Base-Commit mismatch for ${taskId}`
      );
    }

    // 5. Verify working tree is clean
    const statusOutput = await runGit(['status', '--porcelain']);
    assert.equal(statusOutput, '', 'Working tree should be clean after DAG execution');
  });
});
