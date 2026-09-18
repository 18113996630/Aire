import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskContext, recordIteration } from '../../src/core/context.ts';

describe('TaskContext', () => {
  test('createTaskContext initializes with default values', () => {
    const ctx = createTaskContext({
      taskId: 'TASK-001',
      projectPath: '/path/to/project',
      scheme: 'MiniApp',
      taskGoal: 'Add counter button'
    });

    assert.equal(ctx.taskId, 'TASK-001');
    assert.equal(ctx.state, 'IDLE');
    assert.equal(ctx.currentRetry, 0);
    assert.equal(ctx.maxRetries, 3);
    assert.equal(ctx.history.length, 0);
  });

  test('recordIteration adds history entry and increments retry', () => {
    const ctx = createTaskContext({
      taskId: 'TASK-002',
      projectPath: '/path/to/project',
      scheme: 'MiniApp',
      taskGoal: 'Fix view'
    });

    recordIteration(ctx, {
      action: 'INITIAL_PROMPT',
      promptUsed: 'Make view red',
      cliSummary: 'Modified ContentView.swift'
    });

    assert.equal(ctx.history.length, 1);
    assert.equal(ctx.history[0].iteration, 1);
    assert.equal(ctx.history[0].action, 'INITIAL_PROMPT');
  });

  test('TaskContext initializes with visual configuration and default tolerance matrix', () => {
    const ctx = createTaskContext({
      taskId: 'visual-task-1',
      projectPath: '/tmp/test-project',
      scheme: 'MiniApp',
      taskGoal: 'Replicate home card',
      visualConfig: {
        referenceImagePath: '/tmp/ref.png',
        focusAreas: 'Header card and title',
        toleranceMatrix: {
          containerDeltaMax: 7.0,
          spacingPtMax: 2.0,
          textDeltaMax: 15.0,
        },
      },
    });

    assert.equal(ctx.visualConfig?.referenceImagePath, '/tmp/ref.png');
    assert.equal(ctx.visualConfig?.focusAreas, 'Header card and title');
    assert.equal(ctx.visualConfig?.toleranceMatrix.containerDeltaMax, 7.0);
    assert.equal(ctx.visualConfig?.toleranceMatrix.spacingPtMax, 2.0);
    assert.equal(ctx.visualConfig?.toleranceMatrix.textDeltaMax, 15.0);
  });
});
