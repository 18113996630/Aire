import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FlowInteractiveEvaluator } from '../../src/evaluator/flow/flow-interactive-evaluator.ts';
import { FlowOrchestrator } from '../../src/flow/flow-orchestrator.ts';
import { buildFixPrompt } from '../../src/core/prompt-builder.ts';
import type { TaskContext } from '../../src/core/types.ts';

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

describe('Flow Self-Healing Integration Loop', () => {
  it('diagnoses StateDefect, builds fix prompt, and completes full replay on repair', async () => {
    const tmpDir = path.resolve(process.cwd(), 'node_modules/.tmp/flow-self-healing');
    await fs.mkdir(path.join(tmpDir, '.aire/flows'), { recursive: true });

    const flowPath = path.join(tmpDir, '.aire/flows/checkout.json');
    const flowDefinition = {
      schemaVersion: '1.0',
      flowId: 'checkout-flow',
      name: 'Checkout Flow',
      description: 'Cart to confirmation',
      steps: [
        {
          stepId: 'step-1-open-cart',
          action: 'tap',
          target: { type: 'accessibility', identifier: 'flow.button.cart' },
        },
        {
          stepId: 'step-2-confirm-order',
          action: 'tap',
          target: { type: 'accessibility', identifier: 'flow.button.checkout' },
        },
      ],
    };
    await fs.writeFile(flowPath, JSON.stringify(flowDefinition, null, 2), 'utf8');

    let isFixed = false;
    const mockDriver: any = {
      name: 'MockRunner',
      executeFlowBatch: async () => {
        if (!isFixed) {
          // Iteration 1: Fails at step 2 because flow.button.checkout is missing
          return {
            flowId: 'checkout-flow',
            success: false,
            failedStepId: 'step-2-confirm-order',
            completedSteps: 1,
            totalSteps: 2,
            totalDurationMs: 200,
            stepReports: [
              {
                stepId: 'step-1-open-cart',
                action: 'tap',
                success: true,
                targetResolvedBy: 'accessibility',
                durationMs: 100,
              },
              {
                stepId: 'step-2-confirm-order',
                action: 'tap',
                success: false,
                targetResolvedBy: 'none',
                durationMs: 100,
                error: {
                  code: 'ELEMENT_NOT_FOUND',
                  message: "Identifier 'flow.button.checkout' was not found",
                  targetIdentifier: 'flow.button.checkout',
                },
              },
            ],
          };
        }

        // Iteration 2 (Replay): Succeeds
        return {
          flowId: 'checkout-flow',
          success: true,
          completedSteps: 2,
          totalSteps: 2,
          totalDurationMs: 300,
          stepReports: [
            {
              stepId: 'step-1-open-cart',
              action: 'tap',
              success: true,
              targetResolvedBy: 'accessibility',
              durationMs: 150,
            },
            {
              stepId: 'step-2-confirm-order',
              action: 'tap',
              success: true,
              targetResolvedBy: 'accessibility',
              durationMs: 150,
            },
          ],
        };
      },
    };

    const orchestrator = new FlowOrchestrator(mockDriver);
    const evaluator = new FlowInteractiveEvaluator(orchestrator);

    const context: TaskContext = {
      taskId: 'task-flow-heal',
      projectPath: tmpDir,
      scheme: 'App',
      taskGoal: 'Implement Checkout Flow',
      maxRetries: 3,
      currentRetry: 0,
      state: 'EVALUATING',
      history: [],
      flowConfig: {
        flowFile: '.aire/flows/checkout.json',
      },
    };

    // --- Iteration 1: Initial evaluation fails ---
    const initialResult = await evaluator.evaluate(context);
    expect(initialResult.passed).toBe(false);
    expect(initialResult.type).toBe('FLOW_INTERACTIVE');
    expect(initialResult.stateDefects).toBeDefined();
    expect(initialResult.stateDefects?.[0].targetIdentifier).toBe('flow.button.checkout');

    // Generate fix prompt
    const fixPrompt = buildFixPrompt(context, initialResult);
    expect(fixPrompt).toContain('【交互流与状态视觉质检修复指令】');
    expect(fixPrompt).toContain('flow.button.checkout');
    expect(fixPrompt).toContain('ELEMENT_MISSING');

    // --- Developer Agent Simulates Code Fix ---
    isFixed = true;
    context.currentRetry = 1;

    // --- Iteration 2: Full Flow Replay ---
    const replayResult = await evaluator.evaluate(context);
    expect(replayResult.passed).toBe(true);
    expect(replayResult.type).toBe('FLOW_INTERACTIVE');
    expect(replayResult.stateDefects?.length ?? 0).toBe(0);
    expect(replayResult.flowReport.completedSteps).toBe(2);
  });
});
