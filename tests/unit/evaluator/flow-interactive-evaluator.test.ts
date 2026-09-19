import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FlowInteractiveEvaluator } from '../../../src/evaluator/flow/flow-interactive-evaluator.ts';
import type { TaskContext } from '../../../src/core/types.ts';

function expect<T>(actual: T) {
  return {
    toBe(expected: any) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: any) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toHaveLength(expected: number) {
      assert.strictEqual((actual as any)?.length, expected);
    },
    toContain(item: any) {
      assert.ok((actual as any)?.includes(item));
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
  };
}

describe('FlowInteractiveEvaluator Dual-Track Diagnostics', () => {
  it('produces StateDefect when a required element is missing during flow', async () => {
    const mockOrchestrator: any = {
      runFlow: async () => ({
        flowId: 'flow-edit',
        success: false,
        failedStepId: 'step-2',
        completedSteps: 1,
        totalSteps: 2,
        totalDurationMs: 250,
        stepReports: [
          {
            stepId: 'step-1',
            action: 'tap',
            success: true,
            targetResolvedBy: 'accessibility',
            durationMs: 150,
          },
          {
            stepId: 'step-2',
            action: 'tap',
            success: false,
            targetResolvedBy: 'none',
            durationMs: 100,
            error: {
              code: 'ELEMENT_NOT_FOUND',
              message: 'Target flow.button.save not found',
              targetIdentifier: 'flow.button.save',
            },
          },
        ],
      }),
    };

    const tmpDir = path.resolve(process.cwd(), 'node_modules/.tmp/evaluator-test');
    await fs.mkdir(path.join(tmpDir, '.aire/flows'), { recursive: true });
    const flowPath = path.join(tmpDir, '.aire/flows/edit.json');
    await fs.writeFile(
      flowPath,
      JSON.stringify({
        schemaVersion: '1.0',
        flowId: 'flow-edit',
        name: 'Edit',
        description: 'Edit flow',
        steps: [
          { stepId: 'step-1', action: 'tap' },
          { stepId: 'step-2', action: 'tap', target: { type: 'accessibility', identifier: 'flow.button.save' } },
        ],
      }),
      'utf8'
    );

    const evaluator = new FlowInteractiveEvaluator(mockOrchestrator);
    const context: TaskContext = {
      projectPath: tmpDir,
      taskId: 'task-flow-1',
      scheme: 'TestApp',
      taskGoal: 'Test flow edit',
      maxRetries: 3,
      currentRetry: 0,
      state: 'EVALUATING',
      history: [],
      flowConfig: {
        flowFile: '.aire/flows/edit.json',
      },
    };

    const result = await evaluator.evaluate(context);
    expect(result.passed).toBe(false);
    expect(result.type).toBe('FLOW_INTERACTIVE');
    expect(result.stateDefects).toBeDefined();
    expect(result.stateDefects?.length).toBe(1);
    expect(result.stateDefects?.[0].targetIdentifier).toBe('flow.button.save');
    expect(result.stateDefects?.[0].category).toBe('ELEMENT_MISSING');
  });

  it('passes when orchestrator flow executes successfully', async () => {
    const mockOrchestrator: any = {
      runFlow: async () => ({
        flowId: 'flow-success',
        success: true,
        completedSteps: 2,
        totalSteps: 2,
        totalDurationMs: 400,
        stepReports: [
          { stepId: 'step-1', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 200 },
          { stepId: 'step-2', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 200 },
        ],
      }),
    };

    const tmpDir = path.resolve(process.cwd(), 'node_modules/.tmp/evaluator-test');
    await fs.mkdir(path.join(tmpDir, '.aire/flows'), { recursive: true });
    const flowPath = path.join(tmpDir, '.aire/flows/success.json');
    await fs.writeFile(
      flowPath,
      JSON.stringify({
        schemaVersion: '1.0',
        flowId: 'flow-success',
        name: 'Success',
        description: 'Success flow',
        steps: [
          { stepId: 'step-1', action: 'tap' },
          { stepId: 'step-2', action: 'tap' },
        ],
      }),
      'utf8'
    );

    const evaluator = new FlowInteractiveEvaluator(mockOrchestrator);
    const context: TaskContext = {
      projectPath: tmpDir,
      taskId: 'task-flow-pass',
      scheme: 'TestApp',
      taskGoal: 'Test flow success',
      maxRetries: 3,
      currentRetry: 0,
      state: 'EVALUATING',
      history: [],
      flowConfig: {
        flowFile: '.aire/flows/success.json',
      },
    };

    const result = await evaluator.evaluate(context);
    expect(result.passed).toBe(true);
    expect(result.type).toBe('FLOW_INTERACTIVE');
    expect(result.stateDefects?.length ?? 0).toBe(0);
  });
});
