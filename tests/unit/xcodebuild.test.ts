import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { XcodeBuildEvaluator } from '../../src/evaluator/xcodebuild.ts';
import { createTaskContext } from '../../src/core/context.ts';

describe('XcodeBuildEvaluator', () => {
  test('evaluate parses mocked failed xcodebuild execution', async () => {
    // 注入 mock 运行器模拟 xcodebuild 行为
    const mockRunner = async () => ({
      exitCode: 65,
      stdout: `/Path/ContentView.swift:15:3: error: missing return in closure\n** BUILD FAILED **`,
      stderr: ''
    });

    const evaluator = new XcodeBuildEvaluator({ runner: mockRunner });
    const ctx = createTaskContext({
      taskId: 'T-001',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'test'
    });

    const result = await evaluator.evaluate(ctx);
    assert.equal(result.passed, false);
    assert.equal(result.type, 'BUILD');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].line, 15);
  });

  test('evaluate returns passed true on success', async () => {
    const mockRunner = async () => ({
      exitCode: 0,
      stdout: `** BUILD SUCCEEDED **`,
      stderr: ''
    });

    const evaluator = new XcodeBuildEvaluator({ runner: mockRunner });
    const ctx = createTaskContext({
      taskId: 'T-002',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'test'
    });

    const result = await evaluator.evaluate(ctx);
    assert.equal(result.passed, true);
    assert.equal(result.errors.length, 0);
  });
});
