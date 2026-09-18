import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixPrompt } from '../../src/core/prompt-builder.ts';
import { createTaskContext } from '../../src/core/context.ts';
import type { EvaluationResult } from '../../src/core/types.ts';

test('buildFixPrompt generates actionable visual defect prompt when type is VISUAL_REVIEW', () => {
  const ctx = createTaskContext({
    taskId: 't-vis',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate card view',
  });

  const visualResult: EvaluationResult = {
    passed: false,
    type: 'VISUAL_REVIEW',
    summary: '2 visual probes exceeded tolerance',
    errors: [],
    meanDelta: 9.5,
    visualDefects: [
      {
        id: 'bg-fill',
        severity: 'high',
        category: 'color',
        element: 'Card Background',
        probeBox: [16, 60, 377, 200],
        expected: '#F2F2F7',
        actual: '#FFFFFF',
        delta: 13.0,
        tolerance: 7.0,
        claim: 'Card background is pure white #FFFFFF instead of reference #F2F2F7',
      },
      {
        id: 'card-inset',
        severity: 'high',
        category: 'spacing',
        element: 'Card Horizontal Padding',
        probeBox: [0, 60, 40, 200],
        expected: 16.0,
        actual: 24.0,
        delta: 8.0,
        tolerance: 2.0,
        claim: 'Horizontal padding is 24pt, exceeding reference 16pt by 8pt',
      },
    ],
  };

  const prompt = buildFixPrompt(ctx, visualResult);

  assert.match(prompt, /【UI 视觉质检修复指令】/);
  assert.match(prompt, /bg-fill/);
  assert.match(prompt, /#F2F2F7/);
  assert.match(prompt, /#FFFFFF/);
  assert.match(prompt, /card-inset/);
  assert.match(prompt, /16/);
  assert.match(prompt, /24/);
  assert.match(prompt, /严格对齐上方测量目标/);
});

test('buildFixPrompt generates fallback text when visualDefects is empty', () => {
  const ctx = createTaskContext({
    taskId: 't-vis-empty',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate view',
  });

  const visualResult: EvaluationResult = {
    passed: false,
    type: 'VISUAL_REVIEW',
    summary: 'Full screen delta exceeded tolerance',
    errors: [],
    meanDelta: 12.0,
    visualDefects: [],
  };

  const prompt = buildFixPrompt(ctx, visualResult);

  assert.match(prompt, /【UI 视觉质检修复指令】/);
  assert.match(prompt, /未提供具体探针明细，全屏平均色差超标。/);
});

test('buildFixPrompt generates build error prompt when type is BUILD', () => {
  const ctx = createTaskContext({
    taskId: 't-build',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Compile view',
  });

  const buildResult: EvaluationResult = {
    passed: false,
    type: 'BUILD',
    summary: 'Compilation failed',
    errors: [
      {
        file: 'ContentView.swift',
        line: 12,
        column: 4,
        message: 'cannot find Foo in scope',
      },
    ],
  };

  const prompt = buildFixPrompt(ctx, buildResult);

  assert.match(prompt, /【自动修复指令】/);
  assert.match(prompt, /ContentView\.swift/);
  assert.match(prompt, /cannot find Foo in scope/);
});
