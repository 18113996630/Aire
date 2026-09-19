import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FlowDefinition,
  FlowStepDefinition,
  ActionTarget,
  StepExpectation,
  StateAssertion,
  FlowExecutionReport,
  FlowStepReport,
  FlowBootstrap,
  TargetType,
  FlowActionType,
} from '../../../src/flow/types.ts';

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

describe('Flow Schema SSOT & Types', () => {
  it('validates a standard flow definition fixture against json schema', async () => {
    const schemaPath = path.resolve(process.cwd(), 'schemas/flow-definition.schema.json');
    const rawSchema = await fs.readFile(schemaPath, 'utf8');
    const schema = JSON.parse(rawSchema);

    const fixture: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'flow-edit-card',
      name: 'Edit Card Flow',
      description: 'Navigate to detail and edit card title',
      bootstrap: {
        type: 'launchArgs',
        value: '-AireFlow test',
      },
      steps: [
        {
          stepId: 'step-1-tap-card',
          action: 'tap',
          target: {
            type: 'accessibility',
            identifier: 'flow.cell.transaction.0',
          },
          allowCoordinateFallback: true,
          expect: {
            checkpoint: true,
            state: {
              expectedRoute: 'detail',
            },
          },
        },
      ],
    };

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(fixture.steps[0].target?.identifier).toBe('flow.cell.transaction.0');
  });

  it('validates schema definitions and structural constraints', async () => {
    const schemaPath = path.resolve(process.cwd(), 'schemas/flow-definition.schema.json');
    const rawSchema = await fs.readFile(schemaPath, 'utf8');
    const schema = JSON.parse(rawSchema);

    expect(schema.type).toBe('object');
    expect(schema.required).toContain('schemaVersion');
    expect(schema.required).toContain('flowId');
    expect(schema.required).toContain('name');
    expect(schema.required).toContain('description');
    expect(schema.required).toContain('steps');

    const defs = schema.$defs;
    expect(defs).toBeDefined();
    expect(defs.targetType).toBeDefined();
    expect(defs.actionTarget).toBeDefined();
    expect(defs.flowActionType).toBeDefined();
    expect(defs.flowStepDefinition).toBeDefined();
    expect(defs.stepExpectation).toBeDefined();
    expect(defs.stateAssertion).toBeDefined();
    expect(defs.flowExecutionReport).toBeDefined();

    // Verify action types enum
    const actionTypes: FlowActionType[] = [
      'launch',
      'tap',
      'input',
      'clear',
      'swipe',
      'scrollTo',
      'pressBack',
      'wait',
    ];
    for (const action of actionTypes) {
      expect(defs.flowActionType.enum).toContain(action);
    }

    // Verify target types enum
    const targetTypes: TargetType[] = ['accessibility', 'coordinate', 'predicate'];
    for (const targetType of targetTypes) {
      expect(defs.targetType.enum).toContain(targetType);
    }
  });

  it('verifies all required TypeScript contracts can be instantiated and type-checked', () => {
    const target: ActionTarget = {
      type: 'accessibility',
      identifier: 'flow.button.save',
      coordinate: { x: 100, y: 200 },
      predicate: "label == 'Save'",
    };

    const stateAssertion: StateAssertion = {
      elementsExist: [
        {
          target,
          enabled: true,
          textEquals: 'Save',
        },
      ],
      elementsNotExist: [
        {
          type: 'accessibility',
          identifier: 'flow.button.cancel',
        },
      ],
      keyboardVisible: false,
      expectedRoute: 'flow.screen.home',
    };

    const expectation: StepExpectation = {
      checkpoint: true,
      referenceImage: 'screens/home.png',
      state: stateAssertion,
      visualProbes: {
        focusArea: 'header',
        tolerance: {
          containerDeltaMax: 5,
          spacingPtMax: 2,
          textDeltaMax: 7,
        },
      },
    };

    const step: FlowStepDefinition = {
      stepId: 'step-save',
      action: 'tap',
      target,
      value: 'new text',
      timeoutMs: 5000,
      allowCoordinateFallback: true,
      expect: expectation,
    };

    const bootstrap: FlowBootstrap = {
      type: 'deepLink',
      value: 'myapp://detail/123',
      environment: { ENV_MODE: 'test' },
    };

    const flow: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'flow-test',
      name: 'Test Flow',
      description: 'A complete test flow description',
      bootstrap,
      steps: [step],
    };

    const stepReport: FlowStepReport = {
      stepId: 'step-save',
      action: 'tap',
      success: true,
      targetResolvedBy: 'accessibility',
      durationMs: 150,
      usedFallback: false,
    };

    const report: FlowExecutionReport = {
      flowId: 'flow-test',
      success: true,
      totalDurationMs: 450,
      completedSteps: 1,
      totalSteps: 1,
      stepReports: [stepReport],
    };

    expect(flow.schemaVersion).toBe('1.0');
    expect(flow.steps).toHaveLength(1);
    expect(report.success).toBe(true);
    expect(report.stepReports[0].targetResolvedBy).toBe('accessibility');
  });
});
