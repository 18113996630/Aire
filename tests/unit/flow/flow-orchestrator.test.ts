import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlowOrchestrator } from '../../../src/flow/flow-orchestrator.ts';
import type { FlowDefinition } from '../../../src/flow/types.ts';

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

describe('FlowOrchestrator Fallback & Continuity', () => {
  it('successfully executes a multi-step flow and returns consolidated report', async () => {
    const mockDriver: any = {
      name: 'MockDriver',
      executeFlowBatch: async () => ({
        flowId: 'test-flow',
        success: true,
        totalDurationMs: 500,
        completedSteps: 2,
        totalSteps: 2,
        stepReports: [
          { stepId: 'step-1', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 200 },
          { stepId: 'step-2', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 300 },
        ],
      }),
    };

    const orchestrator = new FlowOrchestrator(mockDriver);
    const flow: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'test-flow',
      name: 'Test',
      description: 'Test flow',
      steps: [
        { stepId: 'step-1', action: 'tap', target: { type: 'accessibility', identifier: 'btn-1' } },
        { stepId: 'step-2', action: 'tap', target: { type: 'accessibility', identifier: 'btn-2' } },
      ],
    };

    const report = await orchestrator.runFlow(flow, { artifactDir: '/tmp' });
    expect(report.success).toBe(true);
    expect(report.completedSteps).toBe(2);
    expect(report.stepReports).toHaveLength(2);
  });

  it('triggers Level 2 fallback via SimctlInputDriver when primary fails with allowCoordinateFallback', async () => {
    let batchExecutionCount = 0;
    const resumeStepIds: (string | undefined)[] = [];

    const mockPrimaryDriver: any = {
      name: 'MockXCUITestDriver',
      executeFlowBatch: async (options: any) => {
        batchExecutionCount += 1;
        resumeStepIds.push(options.startStepId);

        if (batchExecutionCount === 1) {
          // First attempt: step-1 succeeds, step-2 fails
          return {
            flowId: 'test-fallback-flow',
            success: false,
            failedStepId: 'step-2',
            completedSteps: 1,
            totalSteps: 3,
            totalDurationMs: 300,
            stepReports: [
              { stepId: 'step-1', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 150 },
              {
                stepId: 'step-2',
                action: 'tap',
                success: false,
                targetResolvedBy: 'none',
                durationMs: 150,
                error: { code: 'ELEMENT_NOT_FOUND', message: 'Element btn-2 not found' },
              },
            ],
          };
        }

        // Resumed attempt from step-3: succeeds
        return {
          flowId: 'test-fallback-flow',
          success: true,
          completedSteps: 1,
          totalSteps: 3,
          totalDurationMs: 200,
          stepReports: [
            { stepId: 'step-3', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 200 },
          ],
        };
      },
    };

    let fallbackTapCalled = false;
    let fallbackTarget: any = null;
    const mockFallbackDriver: any = {
      name: 'MockSimctlDriver',
      tap: async (target: any, allowFallback: boolean) => {
        fallbackTapCalled = true;
        fallbackTarget = target;
        return {
          success: true,
          targetResolvedBy: 'coordinate',
          usedFallback: true,
          durationMs: 50,
        };
      },
    };

    const orchestrator = new FlowOrchestrator(mockPrimaryDriver, mockFallbackDriver);
    const flow: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'test-fallback-flow',
      name: 'Test Fallback',
      description: 'Flow with coordinate fallback on step 2',
      steps: [
        { stepId: 'step-1', action: 'tap', target: { type: 'accessibility', identifier: 'btn-1' } },
        {
          stepId: 'step-2',
          action: 'tap',
          target: { type: 'accessibility', identifier: 'btn-2', coordinate: { x: 50, y: 120 } },
          allowCoordinateFallback: true,
        },
        { stepId: 'step-3', action: 'tap', target: { type: 'accessibility', identifier: 'btn-3' } },
      ],
    };

    const report = await orchestrator.runFlow(flow, { artifactDir: '/tmp' });

    expect(fallbackTapCalled).toBe(true);
    expect(fallbackTarget?.coordinate).toEqual({ x: 50, y: 120 });
    expect(batchExecutionCount).toBe(2);
    expect(resumeStepIds[1]).toBe('step-3');
    expect(report.success).toBe(true);
    expect(report.completedSteps).toBe(3);
    expect(report.stepReports[1].usedFallback).toBe(true);
    expect(report.stepReports[1].targetResolvedBy).toBe('coordinate');
  });

  it('fails immediately without fallback when allowCoordinateFallback is false', async () => {
    let fallbackCalled = false;
    const mockPrimaryDriver: any = {
      name: 'MockDriver',
      executeFlowBatch: async () => ({
        flowId: 'no-fallback-flow',
        success: false,
        failedStepId: 'step-2',
        completedSteps: 1,
        totalSteps: 2,
        totalDurationMs: 200,
        stepReports: [
          { stepId: 'step-1', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 100 },
          {
            stepId: 'step-2',
            action: 'tap',
            success: false,
            targetResolvedBy: 'none',
            durationMs: 100,
            error: { code: 'NOT_FOUND', message: 'Element not found' },
          },
        ],
      }),
    };
    const mockFallbackDriver: any = {
      name: 'MockFallback',
      tap: async () => {
        fallbackCalled = true;
        return { success: true, targetResolvedBy: 'coordinate', durationMs: 10 };
      },
    };

    const orchestrator = new FlowOrchestrator(mockPrimaryDriver, mockFallbackDriver);
    const flow: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'no-fallback-flow',
      name: 'No Fallback',
      description: 'Flow without fallback allowed',
      steps: [
        { stepId: 'step-1', action: 'tap', target: { type: 'accessibility', identifier: 'btn-1' } },
        {
          stepId: 'step-2',
          action: 'tap',
          target: { type: 'accessibility', identifier: 'btn-2', coordinate: { x: 10, y: 20 } },
          allowCoordinateFallback: false,
        },
      ],
    };

    const report = await orchestrator.runFlow(flow, { artifactDir: '/tmp' });
    expect(fallbackCalled).toBe(false);
    expect(report.success).toBe(false);
    expect(report.failedStepId).toBe('step-2');
  });
});
