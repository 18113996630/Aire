import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StateMachine } from '../../src/core/state-machine.ts';
import { createTaskContext } from '../../src/core/context.ts';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';
import { EvaluatorPipeline } from '../../src/evaluator/pipeline.ts';
import { VisualReviewEvaluator } from '../../src/evaluator/visual/visual-evaluator.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';
import type { ISimulatorManager } from '../../src/ios/simulator-manager.ts';
import type { IRefkitBridge } from '../../src/evaluator/visual/refkit-bridge.ts';

test('Visual Fix Loop: Round 1 fails visual review and Round 2 fixes styling to COMPLETED', async () => {
  const tmpDir = path.resolve(`/tmp/aire-visual-fix-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  let round = 0;

  // Mock 编译：恒定成功
  const mockBuild: IEvaluator = {
    name: 'XcodeBuild',
    evaluate: async (ctx) => {
      ctx.appBundlePath = `${tmpDir}/MiniApp.app`;
      return { passed: true, type: 'BUILD', summary: 'Build succeeded', errors: [] };
    },
  };

  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'SIM-UDID',
    installApp: async () => {},
    launchApp: async () => 4321,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async () => {
      round++;
      if (round === 1) {
        // 第一轮：背景色超标
        return {
          meanDelta: 12.0,
          passed: false,
          probeResults: [
            {
              probeId: 'bg-fill',
              expected: '#F2F2F7',
              actual: '#FFFFFF',
              delta: 13.0,
              passed: false,
            },
          ],
          worstBands: [],
        };
      }
      // 第二轮：修正后通过
      return {
        meanDelta: 2.1,
        passed: true,
        probeResults: [
          {
            probeId: 'bg-fill',
            expected: '#F2F2F7',
            actual: '#F2F2F7',
            delta: 0.0,
            passed: true,
          },
        ],
        worstBands: [],
      };
    },
    runDiff: async () => ({ meanDelta: 2.1 }),
  };

  const visualEvaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const pipeline = new EvaluatorPipeline([mockBuild, visualEvaluator]);

  const mockCli = new MockCliAdapter([
    { exitCode: 0, stdout: 'Generated initial view with white background' },
    { exitCode: 0, stdout: 'Adjusted view background to #F2F2F7 based on probe' },
  ]);

  const context = createTaskContext({
    taskId: 'task-visual-loop',
    projectPath: tmpDir,
    scheme: 'MiniApp',
    taskGoal: 'Match reference card background',
    maxRetries: 3,
    visualConfig: {
      referenceImagePath: `${tmpDir}/ref.png`,
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });

  const stateMachine = new StateMachine(context, mockCli, pipeline);
  const finalContext = await stateMachine.run();

  assert.equal(finalContext.state, 'COMPLETED');
  assert.equal(finalContext.currentRetry, 1);
  assert.equal(finalContext.history.length, 2);
  assert.match(finalContext.history[1].promptUsed, /【UI 视觉质检修复指令】/);
  assert.match(finalContext.history[1].promptUsed, /bg-fill/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
