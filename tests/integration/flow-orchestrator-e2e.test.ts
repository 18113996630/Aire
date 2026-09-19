import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TaskGraphCompiler } from '../../src/planner/task-graph-compiler.ts';

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

describe('TaskGraphCompiler Flow Integration', () => {
  it('generates flow verification tasks and writes flow json specs for multi-step flows', async () => {
    const tmpProj = path.resolve(process.cwd(), 'node_modules/.tmp/compiler-flow-e2e');
    await fs.mkdir(tmpProj, { recursive: true });

    const compiler = new TaskGraphCompiler({ projectPath: tmpProj });
    const mockIr: any = {
      appName: 'TestApp',
      targetScheme: 'TestApp',
      flows: [
        {
          id: 'flow-checkout',
          name: 'Checkout Flow',
          description: 'Cart to Payment',
          steps: [
            {
              stepNumber: 1,
              screenId: 'cart',
              action: 'tap(flow.button.pay)',
              expectedState: 'screen.payment',
            },
          ],
        },
      ],
      requirements: [],
      tokens: [],
      screens: [],
      entities: [],
      architecture: {
        layers: {
          models: { files: [] },
          viewModels: { files: [] },
          views: { files: [] },
        },
        fileBoundaries: [],
      },
    };

    const graph = compiler.compile(mockIr);
    const flowTask = graph.tasks.find((t) => t.verification?.flow);
    expect(flowTask).toBeDefined();
    expect(flowTask?.verification.flow?.flowFile).toContain('flow-checkout');

    // Verify flow definition file was generated on disk
    const flowFilePath = path.join(tmpProj, '.aire/flows/flow-checkout.json');
    expect(await fs.stat(flowFilePath)).toBeDefined();
    const raw = await fs.readFile(flowFilePath, 'utf8');
    const flowJson = JSON.parse(raw);
    expect(flowJson.flowId).toBe('flow-checkout');
    expect(flowJson.steps).toHaveLength(1);
    expect(flowJson.steps[0].target.identifier).toBe('flow.button.pay');
  });
});
