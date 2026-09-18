import test from 'node:test';
import assert from 'node:assert/strict';
import { EvaluatorPipeline } from '../../src/evaluator/pipeline.ts';
import { createTaskContext } from '../../src/core/context.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';
import type { EvaluationResult } from '../../src/core/types.ts';

test('EvaluatorPipeline short-circuits on first failing evaluator', async () => {
  let secondCalled = false;

  const firstEvaluator: IEvaluator = {
    name: 'FirstBuild',
    evaluate: async () => ({
      passed: false,
      type: 'BUILD',
      summary: 'Compilation failed',
      errors: [{ file: 'A.swift', line: 1, column: 1, message: 'syntax error' }],
    }),
  };

  const secondEvaluator: IEvaluator = {
    name: 'SecondVisual',
    evaluate: async () => {
      secondCalled = true;
      return { passed: true, type: 'VISUAL_REVIEW', summary: 'Visual pass', errors: [] };
    },
  };

  const pipeline = new EvaluatorPipeline([firstEvaluator, secondEvaluator]);
  const ctx = createTaskContext({ taskId: 't1', projectPath: '/tmp', scheme: 'App', taskGoal: 'Build' });

  const result = await pipeline.evaluate(ctx);

  assert.equal(result.passed, false);
  assert.equal(result.type, 'BUILD');
  assert.equal(secondCalled, false, 'Second evaluator must not be called when first fails');
});

test('EvaluatorPipeline returns final success when all evaluators pass', async () => {
  const firstEvaluator: IEvaluator = {
    name: 'FirstBuild',
    evaluate: async () => ({ passed: true, type: 'BUILD', summary: 'Build pass', errors: [] }),
  };

  const secondEvaluator: IEvaluator = {
    name: 'SecondVisual',
    evaluate: async () => ({ passed: true, type: 'VISUAL_REVIEW', summary: 'Visual pass', errors: [] }),
  };

  const pipeline = new EvaluatorPipeline([firstEvaluator, secondEvaluator]);
  const ctx = createTaskContext({ taskId: 't1', projectPath: '/tmp', scheme: 'App', taskGoal: 'Build' });

  const result = await pipeline.evaluate(ctx);

  assert.equal(result.passed, true);
  assert.equal(result.type, 'VISUAL_REVIEW');
});

test('EvaluatorPipeline returns default success for empty pipeline', async () => {
  const pipeline = new EvaluatorPipeline([]);
  const ctx = createTaskContext({ taskId: 't1', projectPath: '/tmp', scheme: 'App', taskGoal: 'Build' });

  const result = await pipeline.evaluate(ctx);

  assert.equal(result.passed, true);
  assert.equal(result.type, 'BUILD');
  assert.equal(result.summary, 'Empty pipeline');
});
