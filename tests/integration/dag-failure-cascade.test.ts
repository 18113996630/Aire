/**
 * AIRE Layer 2 Integration Test: DAG Failure Cascade & Branch Isolation
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 6.2
 *
 * Validates diamond DAG failure cascade (A -> B, A -> C, B & C -> D):
 * - A succeeds and commits cleanly
 * - B fails evaluation and exhausts retries
 * - B's working tree changes are rolled back hard to baseCommit (working tree is clean)
 * - Dependent downstream task D is cascade-blocked (status: BLOCKED, blockedBy: task-b)
 * - Independent parallel branch C continues and succeeds (status: SUCCEEDED)
 * - Overall DAG execution report status is HALTED
 * - completedTasks contains [A, C], failedTasks contains [B], blockedTasks contains [D]
 * - Verifies --retry-task task-b unblocks D and finishes entire DAG to SUCCEEDED
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

describe('Layer 2 Integration: DAG Failure Cascade & Branch Isolation', () => {
  let testRepoDir: string;

  async function runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: testRepoDir });
    return stdout.trim();
  }

  const diamondYaml = `
version: "1.0.0"
project:
  name: "CascadeApp"
  targetScheme: "CascadeApp"
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
    max_retries: 2
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
    testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-int-cascade-'));
    await runGit(['init', '-b', 'main']);
    await runGit(['config', 'user.name', 'Aire Tester']);
    await runGit(['config', 'user.email', 'tester@aire.local']);
    await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Cascade App\n', 'utf-8');
    await fs.writeFile(path.join(testRepoDir, '.gitignore'), '.aire/\n', 'utf-8');
    await runGit(['add', '.']);
    await runGit(['commit', '-m', 'chore: initial repository structure']);
  });

  afterEach(async () => {
    await fs.rm(testRepoDir, { recursive: true, force: true });
  });

  test('task B failure rolls back dirty changes, cascade-blocks D, allows independent C to succeed, and reports HALTED', async () => {
    const executedTasks: string[] = [];
    let bShouldFail = true;

    const mockCli: ICliAdapter = {
      name: 'CascadeMockCli',
      async isAvailable() {
        return true;
      },
      async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
        const taskIdMatch = params.prompt.match(/- \*\*任务 ID\*\*: `([^`]+)`/);
        const taskId = taskIdMatch ? taskIdMatch[1] : 'unknown';
        executedTasks.push(taskId);

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
              `// Implementation for ${taskId}\npublic struct Component_${taskId.replace(/-/g, '_')} {}\n`,
              'utf-8'
            );
          }
        }

        // If task-b is failing, also write an untracked scratch file to verify clean rollback
        if (taskId === 'task-b' && bShouldFail) {
          const scratchFile = path.join(params.cwd, 'Sources/Services/AuthDraft.tmp');
          await fs.writeFile(scratchFile, '// Uncommitted scratch work\n', 'utf-8');
        }

        return {
          exitCode: 0,
          stdout: `Generated code for ${taskId}`,
          stderr: '',
          durationMs: 5,
        };
      },
    };

    const mockEvaluatorFactory = (task: { id: string }): IEvaluator => ({
      name: 'MockEvaluator',
      evaluate: async () => {
        if (task.id === 'task-b' && bShouldFail) {
          return {
            passed: false,
            type: 'BUILD',
            summary: 'Compilation error in AuthService.swift: missing UserAuth symbol',
            errors: [
              {
                file: 'Sources/Services/AuthService.swift',
                line: 12,
                column: 8,
                message: 'missing UserAuth symbol',
              },
            ],
          };
        }
        return {
          passed: true,
          type: 'BUILD',
          summary: `Build passed for ${task.id}`,
          errors: [],
        };
      },
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

    // Execute DAG
    const report = await scheduler.run(graph, { projectPath: testRepoDir });

    // 1. Overall status assertion
    assert.equal(report.status, 'HALTED');

    // 2. Task categorization assertion
    assert.ok(report.completedTasks.includes('task-a'), 'task-a should be completed');
    assert.ok(report.completedTasks.includes('task-c'), 'task-c should be completed');
    assert.equal(report.completedTasks.length, 2);

    assert.deepEqual(report.failedTasks, ['task-b']);
    assert.deepEqual(report.blockedTasks, ['task-d']);

    // 3. Downstream D was never executed
    assert.ok(!executedTasks.includes('task-d'), 'task-d should never have been executed');

    // 4. Working tree rollback verification:
    // Task B's changes (AuthService.swift and AuthDraft.tmp) must be completely reverted
    const authServiceExists = await fs
      .access(path.join(testRepoDir, 'Sources/Services/AuthService.swift'))
      .then(() => true)
      .catch(() => false);
    assert.equal(authServiceExists, false, 'AuthService.swift should be rolled back and not exist');

    const authDraftExists = await fs
      .access(path.join(testRepoDir, 'Sources/Services/AuthDraft.tmp'))
      .then(() => true)
      .catch(() => false);
    assert.equal(authDraftExists, false, 'AuthDraft.tmp should be cleaned and not exist');

    const gitStatus = await runGit(['status', '--porcelain']);
    assert.equal(gitStatus, '', 'Working tree should be clean after rollback and completion');

    // 5. RunState persistence verification
    const runState = await runStateStore.loadRunState(testRepoDir);
    assert.ok(runState);
    assert.equal(runState.status, 'HALTED');
    assert.equal(runState.tasks['task-a'].status, 'SUCCEEDED');
    assert.equal(runState.tasks['task-b'].status, 'FAILED');
    assert.equal(runState.tasks['task-b'].error?.type, 'VERIFICATION_FAILED');
    assert.equal(runState.tasks['task-c'].status, 'SUCCEEDED');
    assert.equal(runState.tasks['task-d'].status, 'BLOCKED');
    assert.equal(runState.tasks['task-d'].blockedBy, 'task-b');

    // 6. Artifact verification
    const resultA = await artifactManager.getTaskResult(testRepoDir, 'task-a');
    assert.ok(resultA);
    assert.equal(resultA.status, 'SUCCEEDED');

    const resultC = await artifactManager.getTaskResult(testRepoDir, 'task-c');
    assert.ok(resultC);
    assert.equal(resultC.status, 'SUCCEEDED');

    const resultB = await artifactManager.getTaskResult(testRepoDir, 'task-b');
    assert.equal(resultB, null, 'task-b result should not exist');

    const resultD = await artifactManager.getTaskResult(testRepoDir, 'task-d');
    assert.equal(resultD, null, 'task-d result should not exist');

    // 7. Test recovery via --retry-task task-b
    bShouldFail = false; // "Fix" the issue in task-b
    const retryReport = await scheduler.resume(testRepoDir, {
      projectPath: testRepoDir,
      retryTaskId: 'task-b',
    });

    assert.equal(retryReport.status, 'SUCCEEDED');
    assert.ok(retryReport.completedTasks.includes('task-b'));
    assert.ok(retryReport.completedTasks.includes('task-d'));
    assert.equal(retryReport.failedTasks.length, 0);
    assert.equal(retryReport.blockedTasks.length, 0);

    const recoveredRunState = await runStateStore.loadRunState(testRepoDir);
    assert.ok(recoveredRunState);
    assert.equal(recoveredRunState.status, 'SUCCEEDED');
    assert.equal(recoveredRunState.tasks['task-b'].status, 'SUCCEEDED');
    assert.equal(recoveredRunState.tasks['task-d'].status, 'SUCCEEDED');

    const recoveredResultB = await artifactManager.getTaskResult(testRepoDir, 'task-b');
    assert.ok(recoveredResultB);
    assert.equal(recoveredResultB.status, 'SUCCEEDED');

    const recoveredResultD = await artifactManager.getTaskResult(testRepoDir, 'task-d');
    assert.ok(recoveredResultD);
    assert.equal(recoveredResultD.status, 'SUCCEEDED');

    const finalGitStatus = await runGit(['status', '--porcelain']);
    assert.equal(finalGitStatus, '', 'Working tree should be clean after retry completion');
  });
});
