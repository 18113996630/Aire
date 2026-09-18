import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FailureDecision,
  type TaskExecutionStatus,
  type TaskNode,
  type TaskGraphConfig,
  type TaskGraphVerification,
  type DagRunState,
  type TaskRunRecord,
  type TaskResult,
  type WorkspaceContext,
  type CommitMetadata,
  type SchedulerOptions,
  type DagExecutionReport,
  type TaskExecutionOutcome,
  type TaskError
} from '../../../src/dag/types.ts';

test('TaskExecutionStatus covers all 10 required lifecycle states', () => {
  const statuses: TaskExecutionStatus[] = [
    'PENDING',
    'READY',
    'RUNNING',
    'VERIFYING',
    'REPAIRING',
    'RETRYING',
    'SUCCEEDED',
    'FAILED',
    'BLOCKED',
    'CANCELLED'
  ];
  assert.equal(statuses.length, 10);
  assert.ok(statuses.includes('PENDING'));
  assert.ok(statuses.includes('READY'));
  assert.ok(statuses.includes('RUNNING'));
  assert.ok(statuses.includes('VERIFYING'));
  assert.ok(statuses.includes('REPAIRING'));
  assert.ok(statuses.includes('RETRYING'));
  assert.ok(statuses.includes('SUCCEEDED'));
  assert.ok(statuses.includes('FAILED'));
  assert.ok(statuses.includes('BLOCKED'));
  assert.ok(statuses.includes('CANCELLED'));
});

test('FailureDecision covers CASCADE_BLOCK_AND_CONTINUE and ABORT_ALL as both value and type', () => {
  assert.equal(FailureDecision.CASCADE_BLOCK_AND_CONTINUE, 'CASCADE_BLOCK_AND_CONTINUE');
  assert.equal(FailureDecision.ABORT_ALL, 'ABORT_ALL');

  const decisionByEnum: FailureDecision = FailureDecision.CASCADE_BLOCK_AND_CONTINUE;
  const decisionByString: FailureDecision = 'ABORT_ALL';
  const decisions: FailureDecision[] = [decisionByEnum, decisionByString];

  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions, ['CASCADE_BLOCK_AND_CONTINUE', 'ABORT_ALL']);
});

test('TaskNode and TaskGraphVerification conform to task graph schema contracts', () => {
  const verification: TaskGraphVerification = {
    build: { scheme: 'MiniApp' },
    visual: {
      reference: 'fixtures/MiniApp/ref.png',
      focus: 'main_button',
      tolerance: {
        containerDeltaMax: 5,
        spacingPtMax: 2,
        textDeltaMax: 4
      }
    },
    test: {
      testPlan: 'MiniAppTests'
    }
  };

  const taskNode: TaskNode = {
    id: 'task-1',
    title: 'Model Definition',
    goal: 'Create SwiftData model',
    non_goals: ['Do not implement UI'],
    role: 'iOS Developer',
    dependencies: [],
    dependents: ['task-2'],
    allowed_files: ['Models/Item.swift'],
    acceptance_criteria: ['Model compiles cleanly'],
    verification,
    max_retries: 3
  };

  assert.equal(taskNode.id, 'task-1');
  assert.equal(taskNode.dependents[0], 'task-2');
  assert.equal(taskNode.verification.visual?.tolerance?.containerDeltaMax, 5);
});

test('TaskGraphConfig conforms to root configuration contract', () => {
  const config: TaskGraphConfig = {
    version: '1.0.0',
    project: {
      name: 'MiniApp',
      targetScheme: 'MiniApp'
    },
    tasks: [
      {
        id: 'task-1',
        title: 'Task 1',
        goal: 'Goal 1',
        role: 'iOS Developer',
        dependencies: [],
        dependents: [],
        allowed_files: ['App.swift'],
        acceptance_criteria: ['Passes build'],
        verification: { build: true }
      }
    ]
  };

  assert.equal(config.version, '1.0.0');
  assert.equal(config.project.name, 'MiniApp');
  assert.equal(config.tasks.length, 1);
});

test('TaskError, TaskRunRecord and DagRunState conform to state persistence contracts', () => {
  const error: TaskError = {
    type: 'BuildFailure',
    message: 'Compilation error',
    details: { code: 1 }
  };

  const record: TaskRunRecord = {
    taskId: 'task-1',
    status: 'FAILED',
    retryCount: 3,
    baseCommit: 'sha-base',
    commit: 'sha-head',
    startedAt: '2026-09-18T10:00:00Z',
    completedAt: '2026-09-18T10:05:00Z',
    blockedBy: 'task-0',
    error,
    resultPath: '.aire/tasks/task-1/result.json'
  };

  const runState: DagRunState = {
    schemaVersion: '1.0.0',
    graphVersion: '1.0.0',
    graphHash: 'hash123',
    runId: 'run-456',
    graphPath: 'task-graph.yaml',
    status: 'HALTED',
    activeTaskIds: ['task-1'],
    startedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:05:00Z',
    tasks: {
      'task-1': record
    }
  };

  assert.equal(runState.status, 'HALTED');
  assert.equal(runState.tasks['task-1'].error?.message, 'Compilation error');
  assert.equal(runState.tasks['task-1'].blockedBy, 'task-0');
});

test('TaskResult conforms to structured artifact hand-off contract', () => {
  const result: TaskResult = {
    taskId: 'task-1',
    title: 'Model Definition',
    goal: 'Create SwiftData model',
    status: 'SUCCEEDED',
    summary: 'Successfully implemented Item model',
    changedFiles: ['Models/Item.swift'],
    artifacts: ['.aire/tasks/task-1/spec.md'],
    apiContracts: ['struct Item', 'protocol ItemStore'],
    baseCommit: 'commit-base',
    commit: 'commit-final',
    completedAt: '2026-09-18T10:05:00Z'
  };

  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(result.changedFiles, ['Models/Item.swift']);
  assert.deepEqual(result.apiContracts, ['struct Item', 'protocol ItemStore']);
});

test('WorkspaceContext and CommitMetadata conform to workspace strategy contracts', () => {
  const ctx: WorkspaceContext = {
    projectPath: '/path/to/project',
    taskId: 'task-1',
    runId: 'run-1',
    allowedFiles: ['Sources/Main.swift']
  };

  const meta: CommitMetadata = {
    runId: 'run-1',
    taskId: 'task-1',
    baseCommit: 'sha-base',
    title: 'Task 1 Commit'
  };

  assert.equal(ctx.taskId, 'task-1');
  assert.equal(meta.title, 'Task 1 Commit');
});

test('SchedulerOptions, TaskExecutionOutcome and DagExecutionReport conform to scheduler contracts', () => {
  const options: SchedulerOptions = {
    projectPath: '/path/to/project',
    maxConcurrency: 1,
    retryTaskId: 'task-retry'
  };

  const outcome: TaskExecutionOutcome = {
    success: true,
    taskId: 'task-1',
    baseCommit: 'base-sha',
    commit: 'commit-sha',
    changedFiles: ['File.swift'],
    summary: 'Executed cleanly'
  };

  const report: DagExecutionReport = {
    runId: 'run-100',
    status: 'SUCCEEDED',
    durationMs: 1250,
    completedTasks: ['task-1'],
    failedTasks: [],
    blockedTasks: [],
    taskReports: {
      'task-1': outcome
    }
  };

  assert.equal(options.maxConcurrency, 1);
  assert.equal(report.status, 'SUCCEEDED');
  assert.equal(report.taskReports['task-1'].success, true);
});
