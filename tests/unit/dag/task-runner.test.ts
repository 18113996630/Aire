import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaskRunner } from '../../../src/dag/task-runner.ts';
import type { TaskNode, TaskResult, TaskExecutionStatus } from '../../../src/dag/types.ts';
import { XcodeBuildEvaluator } from '../../../src/evaluator/xcodebuild.ts';
import { VisualReviewEvaluator } from '../../../src/evaluator/visual/visual-evaluator.ts';
import { EvaluatorPipeline } from '../../../src/evaluator/pipeline.ts';
import { MockCliAdapter } from '../../../src/runtime/mock.adapter.ts';
import type { IEvaluator } from '../../../src/evaluator/evaluator.interface.ts';
import type { TaskContext } from '../../../src/core/types.ts';

describe('TaskRunner', () => {
  const baseTask: TaskNode = {
    id: 'TASK-1',
    title: 'Implement Home View',
    goal: 'Build SwiftUI Home View layout',
    non_goals: ['Add network requests'],
    role: 'iOS Developer',
    dependencies: [],
    dependents: [],
    allowed_files: ['Views/HomeView.swift'],
    acceptance_criteria: ['HomeView compiles without error'],
    verification: {
      build: true,
    },
    max_retries: 3,
  };

  test('verification with build only creates XcodeBuildEvaluator', () => {
    const runner = new TaskRunner();
    const evaluator = runner.createEvaluator(baseTask);

    assert.ok(evaluator instanceof XcodeBuildEvaluator);
    assert.equal(evaluator.name, 'XcodeBuild');
  });

  test('verification with visual creates EvaluatorPipeline with XcodeBuild and VisualReview', () => {
    const runner = new TaskRunner();
    const visualTask: TaskNode = {
      ...baseTask,
      verification: {
        build: true,
        visual: {
          reference: 'assets/ref-home.png',
          focus: 'header',
          tolerance: {
            containerDeltaMax: 5.0,
            spacingPtMax: 1.5,
            textDeltaMax: 10.0,
          },
        },
      },
    };

    const evaluator = runner.createEvaluator(visualTask);
    assert.ok(evaluator instanceof EvaluatorPipeline);
    assert.equal(evaluator.name, 'EvaluatorPipeline');

    const innerEvaluators = (evaluator as any).evaluators as IEvaluator[];
    assert.equal(innerEvaluators.length, 2);
    assert.ok(innerEvaluators[0] instanceof XcodeBuildEvaluator);
    assert.ok(innerEvaluators[1] instanceof VisualReviewEvaluator);
  });

  test('state changes flow through onStateChange callbacks (RUNNING, VERIFYING, REPAIRING, RETRYING)', async () => {
    const mockCli = new MockCliAdapter();
    let evalCount = 0;
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => {
        evalCount++;
        if (evalCount === 1) {
          return {
            passed: false,
            type: 'BUILD',
            summary: 'Compilation error on line 10',
            errors: [{ file: 'HomeView.swift', line: 10, column: 5, message: 'Syntax error' }],
          };
        }
        return {
          passed: true,
          type: 'BUILD',
          summary: 'Build clean',
          errors: [],
        };
      },
    };

    const runner = new TaskRunner({
      cliAdapter: mockCli,
      evaluatorFactory: () => mockEvaluator,
    });

    const recordedStatuses: TaskExecutionStatus[] = [];
    const outcome = await runner.executeTask(
      baseTask,
      '/test/project',
      'run-123',
      [],
      'commit-base-sha',
      async (status) => {
        recordedStatuses.push(status);
      }
    );

    assert.equal(outcome.success, true);
    assert.equal(outcome.taskId, 'TASK-1');
    assert.equal(outcome.baseCommit, 'commit-base-sha');
    assert.deepEqual(recordedStatuses, ['RUNNING', 'VERIFYING', 'REPAIRING', 'RETRYING', 'VERIFYING']);
  });

  test('successful completion returns success outcome', async () => {
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: true,
        type: 'BUILD',
        summary: 'Build successful without warnings',
        errors: [],
      }),
    };

    const runner = new TaskRunner({
      cliAdapter: mockCli,
      evaluatorFactory: () => mockEvaluator,
      defaultScheme: 'AireTarget',
    });

    const recordedStatuses: TaskExecutionStatus[] = [];
    const outcome = await runner.executeTask(
      baseTask,
      '/test/project',
      'run-456',
      [],
      'base-sha-1',
      async (status) => {
        recordedStatuses.push(status);
      }
    );

    assert.equal(outcome.success, true);
    assert.equal(outcome.taskId, 'TASK-1');
    assert.equal(outcome.baseCommit, 'base-sha-1');
    assert.deepEqual(outcome.changedFiles, []);
    assert.equal(outcome.summary, 'Build successful without warnings');
    assert.deepEqual(recordedStatuses, ['RUNNING', 'VERIFYING']);
  });

  test('exhausted retries returns failure outcome', async () => {
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: false,
        type: 'BUILD',
        summary: 'Persistent syntax error',
        errors: [{ file: 'Error.swift', line: 1, column: 1, message: 'Unresolved identifier' }],
      }),
    };

    const taskWithRetries: TaskNode = {
      ...baseTask,
      max_retries: 2,
    };

    const runner = new TaskRunner({
      cliAdapter: mockCli,
      evaluatorFactory: () => mockEvaluator,
    });

    const recordedStatuses: TaskExecutionStatus[] = [];
    const outcome = await runner.executeTask(
      taskWithRetries,
      '/test/project',
      'run-789',
      [],
      'base-sha-fail',
      async (status) => {
        recordedStatuses.push(status);
      }
    );

    assert.equal(outcome.success, false);
    assert.equal(outcome.taskId, 'TASK-1');
    assert.equal(outcome.baseCommit, 'base-sha-fail');
    assert.deepEqual(outcome.changedFiles, []);
    assert.equal(outcome.summary, 'Task failed after retries');
    assert.equal(outcome.error?.type, 'VERIFICATION_FAILED');
    assert.equal(outcome.error?.message, 'Persistent syntax error');

    // 2 iterations:
    // Iteration 0: RUNNING, VERIFYING, eval fails -> REPAIRING, RETRYING
    // Iteration 1: VERIFYING, eval fails -> max retries exhausted (no more REPAIRING/RETRYING)
    assert.deepEqual(recordedStatuses, ['RUNNING', 'VERIFYING', 'REPAIRING', 'RETRYING', 'VERIFYING']);
  });

  test('correctly passes visualConfig and prompt with dependency results to context', async () => {
    let capturedContext: TaskContext | undefined;
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async (ctx) => {
        capturedContext = ctx;
        return {
          passed: true,
          type: 'BUILD',
          summary: 'Build clean',
          errors: [],
        };
      },
    };

    const runner = new TaskRunner({
      cliAdapter: mockCli,
      evaluatorFactory: () => mockEvaluator,
    });

    const dependencyResults: TaskResult[] = [
      {
        taskId: 'DEP-1',
        title: 'Core Models',
        goal: 'Define User data model',
        status: 'SUCCEEDED',
        summary: 'Created User.swift model with SwiftData',
        changedFiles: ['Models/User.swift'],
        artifacts: ['docs/model.md'],
        baseCommit: 'commit-0',
        commit: 'commit-1',
        completedAt: '2026-09-18T10:00:00Z',
      },
    ];

    const visualTask: TaskNode = {
      ...baseTask,
      verification: {
        build: { scheme: 'CustomScheme' },
        visual: {
          reference: 'specs/ref.png',
          focus: 'body',
          tolerance: {
            containerDeltaMax: 4.0,
            spacingPtMax: 1.0,
            textDeltaMax: 8.0,
          },
        },
      },
    };

    await runner.executeTask(
      visualTask,
      '/workspace/project',
      'run-dep-test',
      dependencyResults,
      'commit-base',
      async () => {}
    );

    assert.ok(capturedContext);
    assert.equal(capturedContext.scheme, 'CustomScheme');
    assert.equal(capturedContext.taskId, 'TASK-1');
    assert.equal(capturedContext.projectPath, '/workspace/project');
    assert.equal(capturedContext.visualConfig?.referenceImagePath, 'specs/ref.png');
    assert.equal(capturedContext.visualConfig?.focusAreas, 'body');
    assert.deepEqual(capturedContext.visualConfig?.toleranceMatrix, {
      containerDeltaMax: 4.0,
      spacingPtMax: 1.0,
      textDeltaMax: 8.0,
    });

    // Verify prompt contains dependency info
    assert.ok(capturedContext.taskGoal.includes('前置直接依赖产物与契约'));
    assert.ok(capturedContext.taskGoal.includes('DEP-1'));
    assert.ok(capturedContext.taskGoal.includes('User.swift'));
  });
});
