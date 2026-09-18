import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SerialDagScheduler,
  WorkspaceInconsistentError,
  MissingTaskResultError,
} from '../../../src/dag/serial-dag-scheduler.ts';
import { TaskGraph } from '../../../src/dag/task-graph.ts';
import { RunStateStore, GraphDriftError } from '../../../src/dag/run-state-store.ts';
import { CascadeExecutionPolicy } from '../../../src/dag/cascade-execution-policy.ts';
import { DisallowedFilesError } from '../../../src/dag/serial-workspace-strategy.ts';
import type {
  TaskNode,
  TaskResult,
  TaskExecutionOutcome,
  TaskExecutionStatus,
  DagRunState,
  WorkspaceContext,
  CommitMetadata,
  TaskError,
} from '../../../src/dag/types.ts';
import type { IWorkspaceStrategy } from '../../../src/dag/workspace-strategy.interface.ts';
import type { IArtifactManager } from '../../../src/dag/artifact-manager.interface.ts';
import type { IRunStateStore } from '../../../src/dag/run-state-store.interface.ts';
import type { ITaskRunner } from '../../../src/dag/task-runner.interface.ts';

// Helper mock factories
function createMockWorkspaceStrategy(overrides: Partial<IWorkspaceStrategy> = {}): IWorkspaceStrategy {
  let commitCounter = 1;
  let currentHead = 'commit-0';
  return {
    prepareWorkspace: async () => {},
    captureSnapshot: async () => currentHead,
    rollbackWorkspace: async (_ctx, baseCommit) => {
      currentHead = baseCommit;
    },
    commitTaskWorkspace: async (_ctx, meta) => {
      currentHead = `commit-${commitCounter++}-${meta.taskId}`;
      return currentHead;
    },
    extractChangedFiles: async () => ['Sources/App.swift'],
    verifyCommitBelongsToTask: async (_projectPath, commitSha, taskId, runId) => {
      return commitSha.includes(taskId);
    },
    cleanupWorkspace: async () => {},
    ...overrides,
  };
}

function createMockRunStateStore(initialState: DagRunState | null = null): IRunStateStore & { state: DagRunState | null; saveCount: number } {
  const store = {
    state: initialState,
    saveCount: 0,
    async saveRunState(_projectPath: string, state: DagRunState): Promise<void> {
      store.state = JSON.parse(JSON.stringify(state));
      store.saveCount++;
    },
    async loadRunState(_projectPath: string): Promise<DagRunState | null> {
      return store.state ? JSON.parse(JSON.stringify(store.state)) : null;
    },
    computeGraphHash(rawYamlContent: string): string {
      return `hash-${rawYamlContent.length}`;
    },
    validateGraphHash(savedHash: string, rawYamlContent: string): void {
      const currentHash = `hash-${rawYamlContent.length}`;
      if (savedHash !== currentHash) {
        throw new GraphDriftError(savedHash, currentHash);
      }
    },
  };
  return store;
}

function createMockArtifactManager(): IArtifactManager & { results: Map<string, TaskResult> } {
  const results = new Map<string, TaskResult>();
  return {
    results,
    async saveTaskResult(_projectPath: string, result: TaskResult): Promise<void> {
      results.set(result.taskId, result);
    },
    async getTaskResult(_projectPath: string, taskId: string): Promise<TaskResult | null> {
      return results.get(taskId) ?? null;
    },
    async getDirectDependencyResults(_projectPath: string, dependencyIds: string[]): Promise<TaskResult[]> {
      return dependencyIds
        .map((id) => results.get(id))
        .filter((r): r is TaskResult => r !== undefined);
    },
    async reconstructTaskResult(
      _projectPath: string,
      task: TaskNode,
      baseCommit: string,
      commit: string,
      changedFiles: string[]
    ): Promise<TaskResult> {
      const reconstructed: TaskResult = {
        taskId: task.id,
        title: task.title,
        goal: task.goal,
        status: 'SUCCEEDED',
        summary: `Reconstructed for ${task.id}`,
        changedFiles,
        artifacts: [],
        baseCommit,
        commit,
        completedAt: new Date().toISOString(),
      };
      results.set(task.id, reconstructed);
      return reconstructed;
    },
  };
}

function createMockTaskRunner(
  behavior: Record<
    string,
    {
      success: boolean;
      summary?: string;
      error?: TaskError;
      artifacts?: string[];
      apiContracts?: string[];
    }
  >
): ITaskRunner & { executedTasks: string[]; stateHistory: Array<{ taskId: string; status: TaskExecutionStatus }> } {
  const executedTasks: string[] = [];
  const stateHistory: Array<{ taskId: string; status: TaskExecutionStatus }> = [];

  return {
    executedTasks,
    stateHistory,
    async executeTask(
      task: TaskNode,
      _projectPath: string,
      _runId: string,
      _dependencyResults: TaskResult[],
      baseCommit: string,
      onStateChange: (status: TaskExecutionStatus) => Promise<void>
    ): Promise<TaskExecutionOutcome> {
      executedTasks.push(task.id);
      await onStateChange('RUNNING');
      stateHistory.push({ taskId: task.id, status: 'RUNNING' });

      await onStateChange('VERIFYING');
      stateHistory.push({ taskId: task.id, status: 'VERIFYING' });

      const outcomeConfig = behavior[task.id] ?? { success: true };
      if (outcomeConfig.success) {
        return {
          success: true,
          taskId: task.id,
          baseCommit,
          summary: outcomeConfig.summary ?? `Task ${task.id} succeeded`,
          artifacts: outcomeConfig.artifacts,
          apiContracts: outcomeConfig.apiContracts,
        };
      } else {
        return {
          success: false,
          taskId: task.id,
          baseCommit,
          error: outcomeConfig.error ?? {
            type: 'VERIFICATION_FAILED',
            message: `Task ${task.id} failed verification`,
          },
          summary: outcomeConfig.summary ?? `Task ${task.id} failed`,
        };
      }
    },
  };
}

describe('SerialDagScheduler', () => {
  const linearYaml = `
version: "1.0.0"
project:
  name: "TestProject"
  targetScheme: "App"
tasks:
  - id: "task-a"
    title: "Task A"
    goal: "Goal A"
    role: "iOS Developer"
    dependencies: []
    allowed_files: ["A.swift"]
    acceptance_criteria: ["A works"]
  - id: "task-b"
    title: "Task B"
    goal: "Goal B"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["B.swift"]
    acceptance_criteria: ["B works"]
`;

  const parallelYaml = `
version: "1.0.0"
project:
  name: "TestProject"
  targetScheme: "App"
tasks:
  - id: "task-a"
    title: "Task A"
    goal: "Goal A"
    role: "iOS Developer"
    dependencies: []
    allowed_files: ["A.swift"]
    acceptance_criteria: ["A works"]
  - id: "task-b"
    title: "Task B"
    goal: "Goal B"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["B.swift"]
    acceptance_criteria: ["B works"]
  - id: "task-c"
    title: "Task C"
    goal: "Goal C"
    role: "iOS Developer"
    dependencies: []
    allowed_files: ["C.swift"]
    acceptance_criteria: ["C works"]
`;

  test('Case 1: Linear 2-task schedule - both succeed, final report and run state status is SUCCEEDED', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();
    const taskRunner = createMockTaskRunner({
      'task-a': { success: true },
      'task-b': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    const report = await scheduler.run(graph, { projectPath: '/mock/project' });

    assert.equal(report.status, 'SUCCEEDED');
    assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);
    assert.deepEqual(report.failedTasks, []);
    assert.deepEqual(report.blockedTasks, []);
    assert.deepEqual(taskRunner.executedTasks, ['task-a', 'task-b']);

    // Check RunState in store
    assert.ok(runStateStore.state);
    assert.equal(runStateStore.state.status, 'SUCCEEDED');
    assert.equal(runStateStore.state.activeTaskIds.length, 0);
    assert.equal(runStateStore.state.tasks['task-a'].status, 'SUCCEEDED');
    assert.equal(runStateStore.state.tasks['task-b'].status, 'SUCCEEDED');

    // Check ArtifactManager saved results
    assert.ok(artifactManager.results.has('task-a'));
    assert.ok(artifactManager.results.has('task-b'));
  });

  test('Case 2: Single branch failure - downstream marked BLOCKED, independent branch succeeds, final state HALTED', async () => {
    const graph = TaskGraph.fromYaml(parallelYaml);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();
    const executionPolicy = new CascadeExecutionPolicy();
    const taskRunner = createMockTaskRunner({
      'task-a': { success: false, summary: 'Task A compiler error' },
      'task-c': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      executionPolicy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: parallelYaml,
    });

    const report = await scheduler.run(graph, { projectPath: '/mock/project' });

    assert.equal(report.status, 'HALTED');
    assert.ok(report.completedTasks.includes('task-c'));
    assert.ok(report.failedTasks.includes('task-a'));
    assert.ok(report.blockedTasks.includes('task-b'));

    // Verify task-b was never executed by TaskRunner
    assert.ok(!taskRunner.executedTasks.includes('task-b'));
    assert.ok(taskRunner.executedTasks.includes('task-a'));
    assert.ok(taskRunner.executedTasks.includes('task-c'));

    // Check RunState in store
    assert.ok(runStateStore.state);
    assert.equal(runStateStore.state.status, 'HALTED');
    assert.equal(runStateStore.state.tasks['task-a'].status, 'FAILED');
    assert.equal(runStateStore.state.tasks['task-b'].status, 'BLOCKED');
    assert.equal(runStateStore.state.tasks['task-b'].blockedBy, 'task-a');
    assert.equal(runStateStore.state.tasks['task-c'].status, 'SUCCEEDED');
  });

  test('Case 3: Graph drift check during resume throws GraphDriftError', async () => {
    const runStateStore = createMockRunStateStore({
      schemaVersion: '1.0.0',
      graphVersion: '1.0.0',
      graphHash: 'hash-original',
      runId: 'run-123',
      graphPath: '/mock/project/task-graph.yaml',
      status: 'HALTED',
      activeTaskIds: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: {
        'task-a': { taskId: 'task-a', status: 'SUCCEEDED', retryCount: 0 },
        'task-b': { taskId: 'task-b', status: 'FAILED', retryCount: 3 },
      },
    });

    const scheduler = new SerialDagScheduler({
      runStateStore,
      rawYamlContent: 'modified yaml content that produces different hash',
    });

    await assert.rejects(
      async () => {
        await scheduler.resume('/mock/project');
      },
      (err: any) => {
        return err instanceof GraphDriftError;
      }
    );
  });

  test('Case 4: --retry-task <id> resets failed and blocked tasks to PENDING, derives ready states properly', async () => {
    const initialRunState: DagRunState = {
      schemaVersion: '1.0.0',
      graphVersion: '1.0.0',
      graphHash: `hash-${linearYaml.length}`,
      runId: 'run-retry',
      graphPath: '/mock/project/task-graph.yaml',
      status: 'HALTED',
      activeTaskIds: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: {
        'task-a': { taskId: 'task-a', status: 'FAILED', retryCount: 3, error: { type: 'ERROR', message: 'Fail' } },
        'task-b': { taskId: 'task-b', status: 'BLOCKED', retryCount: 0, blockedBy: 'task-a' },
      },
    };

    const runStateStore = createMockRunStateStore(initialRunState);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const artifactManager = createMockArtifactManager();
    const taskRunner = createMockTaskRunner({
      'task-a': { success: true },
      'task-b': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      runStateStore,
      workspaceStrategy,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    // Test retry on a non-failed task throws
    await assert.rejects(
      async () => {
        await scheduler.resume('/mock/project', {
          projectPath: '/mock/project',
          retryTaskId: 'task-b', // task-b is BLOCKED, not FAILED
        });
      },
      /not in FAILED state/
    );

    // Now retry task-a (which IS FAILED)
    const report = await scheduler.resume('/mock/project', {
      projectPath: '/mock/project',
      retryTaskId: 'task-a',
    });

    assert.equal(report.status, 'SUCCEEDED');
    assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);
    assert.deepEqual(taskRunner.executedTasks, ['task-a', 'task-b']);
    assert.equal(runStateStore.state?.status, 'SUCCEEDED');
    assert.equal(runStateStore.state?.tasks['task-a'].status, 'SUCCEEDED');
    assert.equal(runStateStore.state?.tasks['task-b'].status, 'SUCCEEDED');
  });

  describe('Case 5: Crash recovery calibration when interrupted mid-run', () => {
    test('Scenario A: Interrupted before commit (HEAD === baseCommit) rolls back and resets to PENDING', async () => {
      const interruptedState: DagRunState = {
        schemaVersion: '1.0.0',
        graphVersion: '1.0.0',
        graphHash: `hash-${linearYaml.length}`,
        runId: 'run-crash-a',
        graphPath: '/mock/project/task-graph.yaml',
        status: 'RUNNING',
        activeTaskIds: ['task-a'],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: {
          'task-a': { taskId: 'task-a', status: 'RUNNING', retryCount: 0, baseCommit: 'commit-0' },
          'task-b': { taskId: 'task-b', status: 'PENDING', retryCount: 0 },
        },
      };

      let rolledBackBase: string | null = null;
      const workspaceStrategy = createMockWorkspaceStrategy({
        captureSnapshot: async () => 'commit-0', // HEAD === baseCommit
        rollbackWorkspace: async (_ctx, base) => {
          rolledBackBase = base;
        },
      });

      const runStateStore = createMockRunStateStore(interruptedState);
      const artifactManager = createMockArtifactManager();
      const taskRunner = createMockTaskRunner({
        'task-a': { success: true },
        'task-b': { success: true },
      });

      const scheduler = new SerialDagScheduler({
        workspaceStrategy,
        runStateStore,
        artifactManager,
        taskRunner,
        rawYamlContent: linearYaml,
      });

      const report = await scheduler.resume('/mock/project');

      assert.equal(rolledBackBase, 'commit-0');
      assert.equal(report.status, 'SUCCEEDED');
      assert.deepEqual(taskRunner.executedTasks, ['task-a', 'task-b']);
    });

    test('Scenario B: Interrupted after commit with matching Git trailers reconstructs TaskResult and marks SUCCEEDED', async () => {
      const interruptedState: DagRunState = {
        schemaVersion: '1.0.0',
        graphVersion: '1.0.0',
        graphHash: `hash-${linearYaml.length}`,
        runId: 'run-crash-b',
        graphPath: '/mock/project/task-graph.yaml',
        status: 'RUNNING',
        activeTaskIds: ['task-a'],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: {
          'task-a': { taskId: 'task-a', status: 'RUNNING', retryCount: 0, baseCommit: 'commit-0' },
          'task-b': { taskId: 'task-b', status: 'PENDING', retryCount: 0 },
        },
      };

      const workspaceStrategy = createMockWorkspaceStrategy({
        captureSnapshot: async () => 'commit-task-a-new', // HEAD !== baseCommit
        verifyCommitBelongsToTask: async (_path, sha, taskId, runId) => {
          return sha === 'commit-task-a-new' && taskId === 'task-a' && runId === 'run-crash-b';
        },
      });

      const runStateStore = createMockRunStateStore(interruptedState);
      const artifactManager = createMockArtifactManager();
      // task-a should NOT be executed again by TaskRunner because it was committed!
      const taskRunner = createMockTaskRunner({
        'task-b': { success: true },
      });

      const scheduler = new SerialDagScheduler({
        workspaceStrategy,
        runStateStore,
        artifactManager,
        taskRunner,
        rawYamlContent: linearYaml,
      });

      const report = await scheduler.resume('/mock/project');

      assert.equal(report.status, 'SUCCEEDED');
      assert.deepEqual(taskRunner.executedTasks, ['task-b']); // Only task-b executed!
      assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);

      // task-a result was reconstructed
      const taskAResult = await artifactManager.getTaskResult('/mock/project', 'task-a');
      assert.ok(taskAResult);
      assert.equal(taskAResult.status, 'SUCCEEDED');
      assert.equal(taskAResult.commit, 'commit-task-a-new');
    });

    test('Scenario C: Interrupted after commit but trailers do NOT match throws WorkspaceInconsistentError', async () => {
      const interruptedState: DagRunState = {
        schemaVersion: '1.0.0',
        graphVersion: '1.0.0',
        graphHash: `hash-${linearYaml.length}`,
        runId: 'run-crash-c',
        graphPath: '/mock/project/task-graph.yaml',
        status: 'RUNNING',
        activeTaskIds: ['task-a'],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: {
          'task-a': { taskId: 'task-a', status: 'RUNNING', retryCount: 0, baseCommit: 'commit-0' },
          'task-b': { taskId: 'task-b', status: 'PENDING', retryCount: 0 },
        },
      };

      const workspaceStrategy = createMockWorkspaceStrategy({
        captureSnapshot: async () => 'commit-rogue-head', // HEAD !== baseCommit
        verifyCommitBelongsToTask: async () => false, // Trailers do not match!
      });

      const runStateStore = createMockRunStateStore(interruptedState);
      const artifactManager = createMockArtifactManager();
      const taskRunner = createMockTaskRunner({});

      const scheduler = new SerialDagScheduler({
        workspaceStrategy,
        runStateStore,
        artifactManager,
        taskRunner,
        rawYamlContent: linearYaml,
      });

      await assert.rejects(
        async () => {
          await scheduler.resume('/mock/project');
        },
        (err: any) => {
          return err instanceof WorkspaceInconsistentError;
        }
      );
    });

    test('Scenario D: Reconciles missing TaskResult for previously SUCCEEDED task', async () => {
      const interruptedState: DagRunState = {
        schemaVersion: '1.0.0',
        graphVersion: '1.0.0',
        graphHash: `hash-${linearYaml.length}`,
        runId: 'run-reconcile',
        graphPath: '/mock/project/task-graph.yaml',
        status: 'HALTED',
        activeTaskIds: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: {
          'task-a': { taskId: 'task-a', status: 'SUCCEEDED', retryCount: 0, baseCommit: 'c0', commit: 'c1' },
          'task-b': { taskId: 'task-b', status: 'PENDING', retryCount: 0 },
        },
      };

      const runStateStore = createMockRunStateStore(interruptedState);
      const artifactManager = createMockArtifactManager();
      // Notice: artifactManager currently has NO result for task-a!
      const workspaceStrategy = createMockWorkspaceStrategy();
      const taskRunner = createMockTaskRunner({
        'task-b': { success: true },
      });

      const scheduler = new SerialDagScheduler({
        workspaceStrategy,
        runStateStore,
        artifactManager,
        taskRunner,
        rawYamlContent: linearYaml,
      });

      const report = await scheduler.resume('/mock/project');

      assert.equal(report.status, 'SUCCEEDED');
      // Verify task-a result was reconciled/reconstructed
      const reconciled = await artifactManager.getTaskResult('/mock/project', 'task-a');
      assert.ok(reconciled);
      assert.equal(reconciled.commit, 'c1');
    });
  });

  test('Case 6: run() reads graphPath from disk to compute graphHash matching resume() without rawYamlContent', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-hash-test-'));
    try {
      const yamlWithComments = `# Important project configuration\nversion: "1.0.0"\n# Project details\nproject:\n  name: "HashTest"\n  targetScheme: "App"\ntasks:\n  - id: "task-a"\n    title: "Task A"\n    goal: "Goal A"\n    role: "iOS Developer"\n    dependencies: []\n    allowed_files: ["A.swift"]\n    acceptance_criteria: ["A works"]\n`;
      const graphFile = path.join(tmpDir, 'task-graph.yaml');
      await fs.writeFile(graphFile, yamlWithComments, 'utf-8');

      const graph = TaskGraph.fromYaml(yamlWithComments);
      const realStore = new RunStateStore();
      const workspaceStrategy = createMockWorkspaceStrategy();
      const artifactManager = createMockArtifactManager();
      const taskRunner = createMockTaskRunner({
        'task-a': { success: true },
      });

      // No rawYamlContent passed - scheduler should read task-graph.yaml from disk
      const scheduler = new SerialDagScheduler({
        workspaceStrategy,
        runStateStore: realStore,
        artifactManager,
        taskRunner,
        graphPath: graphFile,
      });

      const report = await scheduler.run(graph, { projectPath: tmpDir });
      assert.equal(report.status, 'SUCCEEDED');

      // Now resume without rawYamlContent - should NOT throw GraphDriftError
      const resumeScheduler = new SerialDagScheduler({
        workspaceStrategy,
        runStateStore: realStore,
        artifactManager,
        taskRunner,
        graphPath: graphFile,
      });

      const resumeReport = await resumeScheduler.resume(tmpDir);
      assert.equal(resumeReport.status, 'SUCCEEDED');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('Case 7: onStateChange increments taskRecord.retryCount when status is RETRYING', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();

    const customRunner: ITaskRunner = {
      async executeTask(
        task,
        _projectPath,
        _runId,
        _dependencyResults,
        baseCommit,
        onStateChange
      ): Promise<TaskExecutionOutcome> {
        await onStateChange('RUNNING');
        await onStateChange('VERIFYING');
        await onStateChange('REPAIRING');
        await onStateChange('RETRYING'); // triggers retryCount increment
        return {
          success: true,
          taskId: task.id,
          baseCommit,
        };
      },
    };

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner: customRunner,
      rawYamlContent: linearYaml,
    });

    await scheduler.run(graph, { projectPath: '/mock/project' });

    assert.ok(runStateStore.state);
    // Task A had RETRYING emitted once, so retryCount must be 1
    assert.equal(runStateStore.state.tasks['task-a'].retryCount, 1);
  });

  test('Case 8: run() sets defaultScheme from graph.project.targetScheme onto TaskRunner', async () => {
    const yamlWithScheme = `
version: "1.0.0"
project:
  name: "SchemeApp"
  targetScheme: "CustomScheme"
tasks:
  - id: "task-scheme"
    title: "Test Scheme"
    goal: "Goal"
    role: "iOS Developer"
    dependencies: []
    allowed_files: ["Scheme.swift"]
    acceptance_criteria: ["compiles"]
`;
    const graph = TaskGraph.fromYaml(yamlWithScheme);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();

    let schemeReceived: string | undefined;
    const customRunner: ITaskRunner = {
      async executeTask() {
        return { success: true, taskId: 'task-scheme' };
      },
      setDefaultScheme(scheme?: string) {
        schemeReceived = scheme;
      },
    };

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner: customRunner,
      rawYamlContent: yamlWithScheme,
    });

    await scheduler.run(graph, { projectPath: '/mock/project' });
    assert.equal(schemeReceived, 'CustomScheme');
  });

  test('Case 9: DisallowedFilesError during commit triggers rollback and cascade-blocks downstream tasks', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    let rollbackCalled = false;
    let rollbackCommit: string | undefined;

    const workspaceStrategy = createMockWorkspaceStrategy({
      commitTaskWorkspace: async (_ctx, _meta) => {
        throw new DisallowedFilesError(['Forbidden.swift']);
      },
      rollbackWorkspace: async (_ctx, baseCommit) => {
        rollbackCalled = true;
        rollbackCommit = baseCommit;
      },
    });

    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();
    const taskRunner = createMockTaskRunner({
      'task-a': { success: true },
      'task-b': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    const report = await scheduler.run(graph, { projectPath: '/mock/project' });

    assert.equal(report.status, 'HALTED');
    assert.deepEqual(report.failedTasks, ['task-a']);
    assert.deepEqual(report.blockedTasks, ['task-b']);
    assert.equal(rollbackCalled, true);
    assert.equal(rollbackCommit, 'commit-0');

    const taskARecord = runStateStore.state?.tasks['task-a'];
    assert.equal(taskARecord?.status, 'FAILED');
    assert.equal(taskARecord?.error?.type, 'DISALLOWED_FILES_MODIFIED');
    assert.match(taskARecord?.error?.message ?? '', /Forbidden\.swift/);

    const taskBRecord = runStateStore.state?.tasks['task-b'];
    assert.equal(taskBRecord?.status, 'BLOCKED');
    assert.equal(taskBRecord?.blockedBy, 'task-a');
  });

  test('Case 10: Structured Artifact Hand-Off propagates apiContracts and artifacts into TaskResult', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();

    const savedResults = new Map<string, TaskResult>();
    const artifactManager: IArtifactManager = {
      ...createMockArtifactManager(),
      saveTaskResult: async (_projectPath, result) => {
        savedResults.set(result.taskId, result);
      },
    };

    const taskRunner = createMockTaskRunner({
      'task-a': {
        success: true,
        apiContracts: ['struct User: Codable', 'protocol UserStore'],
        artifacts: ['docs/architecture.md'],
      },
      'task-b': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    await scheduler.run(graph, { projectPath: '/mock/project' });

    const taskAResult = savedResults.get('task-a');
    assert.ok(taskAResult);
    assert.deepEqual(taskAResult.apiContracts, ['struct User: Codable', 'protocol UserStore']);
    assert.deepEqual(taskAResult.artifacts, ['docs/architecture.md']);
  });

  test('Case 11: cleanupWorkspace failure after successful commit does not rollback commit or fail the task', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    let rollbackCalled = false;
    let cleanupCalled = false;

    const workspaceStrategy = createMockWorkspaceStrategy({
      cleanupWorkspace: async () => {
        cleanupCalled = true;
        throw new Error('Worktree cleanup failed (disk IO or lock error)');
      },
      rollbackWorkspace: async () => {
        rollbackCalled = true;
      },
    });

    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();
    const taskRunner = createMockTaskRunner({
      'task-a': { success: true },
      'task-b': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    const report = await scheduler.run(graph, { projectPath: '/mock/project' });

    assert.equal(cleanupCalled, true);
    assert.equal(rollbackCalled, false, 'Rollback should never be called when cleanupWorkspace fails after commit');
    assert.equal(report.status, 'SUCCEEDED');
    assert.deepEqual(report.completedTasks, ['task-a', 'task-b']);
    assert.equal(runStateStore.state?.tasks['task-a']?.status, 'SUCCEEDED');
    assert.equal(runStateStore.state?.tasks['task-b']?.status, 'SUCCEEDED');
  });

  test('Case 12: Missing dependency TaskResult for SUCCEEDED task triggers reconstruct', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();

    let reconstructCalledFor: string | null = null;
    const originalReconstruct = artifactManager.reconstructTaskResult;
    artifactManager.reconstructTaskResult = async (projectPath, task, baseCommit, commit, changedFiles) => {
      reconstructCalledFor = task.id;
      return originalReconstruct(projectPath, task, baseCommit, commit, changedFiles);
    };

    const taskRunner = createMockTaskRunner({
      'task-a': { success: true },
      'task-b': { success: true },
    });

    // We simulate that task-a finishes, but right before task-b runs, task-a's result is deleted from artifactManager
    const originalSave = artifactManager.saveTaskResult;
    artifactManager.saveTaskResult = async (projectPath, result) => {
      await originalSave(projectPath, result);
      if (result.taskId === 'task-a') {
        artifactManager.results.delete('task-a');
      }
    };

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    const report = await scheduler.run(graph, { projectPath: '/mock/project' });
    assert.equal(reconstructCalledFor, 'task-a', 'Should have reconstructed missing task-a result');
    assert.equal(report.status, 'SUCCEEDED');
  });

  test('Case 13: Throws MissingTaskResultError when dependency TaskResult cannot be reconstructed', async () => {
    const graph = TaskGraph.fromYaml(linearYaml);
    const workspaceStrategy = createMockWorkspaceStrategy();
    const runStateStore = createMockRunStateStore();
    const artifactManager = createMockArtifactManager();

    artifactManager.getTaskResult = async () => null;
    artifactManager.reconstructTaskResult = async () => null as any;

    const taskRunner = createMockTaskRunner({
      'task-a': { success: true },
      'task-b': { success: true },
    });

    const scheduler = new SerialDagScheduler({
      workspaceStrategy,
      runStateStore,
      artifactManager,
      taskRunner,
      rawYamlContent: linearYaml,
    });

    await assert.rejects(
      async () => {
        await scheduler.run(graph, { projectPath: '/mock/project' });
      },
      (err: any) => {
        assert.ok(err instanceof MissingTaskResultError);
        assert.equal(err.dependencyId, 'task-a');
        assert.equal(err.taskId, 'task-b');
        return true;
      }
    );
  });
});

