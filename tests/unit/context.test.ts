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
});
