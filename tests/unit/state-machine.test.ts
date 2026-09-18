import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StateMachine } from '../../src/core/state-machine.ts';
import { createTaskContext } from '../../src/core/context.ts';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';

describe('StateMachine', () => {
  test('completes task when build succeeds on first iteration', async () => {
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: true,
        type: 'BUILD',
        summary: 'Build clean',
        errors: []
      })
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: mockEvaluator,
      skipGit: true // 单测跳过真实 git
    });

    const ctx = createTaskContext({
      taskId: 'T-SUCCESS',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Add greeting'
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'COMPLETED');
    assert.equal(finalCtx.currentRetry, 0);
  });

  test('fixes error and completes when second iteration succeeds', async () => {
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
            summary: '1 error',
            errors: [{ file: 'ContentView.swift', line: 10, column: 5, message: 'syntax error' }]
          };
        }
        return {
          passed: true,
          type: 'BUILD',
          summary: 'Build clean',
          errors: []
        };
      }
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: mockEvaluator,
      skipGit: true
    });

    const ctx = createTaskContext({
      taskId: 'T-FIX',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Fix view'
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'COMPLETED');
    assert.equal(finalCtx.currentRetry, 1);
  });

  test('fails and terminates when max retries exceeded', async () => {
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: false,
        type: 'BUILD',
        summary: 'Always fails',
        errors: [{ file: 'Error.swift', line: 1, column: 1, message: 'fatal error' }]
      })
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: mockEvaluator,
      skipGit: true
    });

    const ctx = createTaskContext({
      taskId: 'T-FAIL',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Unfixable task',
      maxRetries: 2
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'FAILED');
    assert.equal(finalCtx.currentRetry, 2);
  });

  test('handles CLI non-zero exitCode and triggers fix loop or failure', async () => {
    let callCount = 0;
    const failingCli = {
      name: 'FailingCli',
      isAvailable: async () => true,
      execute: async () => {
        callCount++;
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'syntax error in swift tool',
          durationMs: 10
        };
      }
    };
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: true,
        type: 'BUILD',
        summary: 'Build clean',
        errors: []
      })
    };

    const machine = new StateMachine({
      cliAdapter: failingCli,
      evaluator: mockEvaluator,
      skipGit: true
    });

    const ctx = createTaskContext({
      taskId: 'T-CLI-FAIL',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'CLI fail test',
      maxRetries: 2
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'FAILED');
    assert.equal(callCount, 2);
    assert.equal(finalCtx.history[0].cliSummary?.includes('[Exit 1]'), true);
  });

  test('transitions to FAILED when evaluator throws unhandled exception', async () => {
    const mockCli = new MockCliAdapter();
    const crashingEvaluator: IEvaluator = {
      name: 'CrashingEvaluator',
      evaluate: async () => {
        throw new Error('Simulator process crashed unexpectedly');
      }
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: crashingEvaluator,
      skipGit: true
    });

    const ctx = createTaskContext({
      taskId: 'T-CRASH',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Crash test'
    });

    await assert.rejects(async () => {
      await machine.run(ctx);
    }, /Simulator process crashed unexpectedly/);

    assert.equal(ctx.state, 'FAILED');
  });
});
