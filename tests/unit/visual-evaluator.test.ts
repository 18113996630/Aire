import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualReviewEvaluator } from '../../src/evaluator/visual/visual-evaluator.ts';
import { createTaskContext } from '../../src/core/context.ts';
import type { ISimulatorManager } from '../../src/ios/simulator-manager.ts';
import type { IRefkitBridge, RefkitBatchReport } from '../../src/evaluator/visual/refkit-bridge.ts';

test('VisualReviewEvaluator intercepts when probes fail and returns VisualDefects', async () => {
  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    installApp: async () => {},
    launchApp: async () => 1234,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async (): Promise<RefkitBatchReport> => ({
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
    }),
    runDiff: async () => ({ meanDelta: 12.0 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate home',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });
  ctx.appBundlePath = '/tmp/MiniApp.app';

  const result = await evaluator.evaluate(ctx);

  assert.equal(result.passed, false);
  assert.equal(result.type, 'VISUAL_REVIEW');
  assert.equal(result.visualDefects?.length, 1);
  assert.equal(result.visualDefects?.[0].id, 'bg-fill');
  assert.equal(result.visualDefects?.[0].expected, '#F2F2F7');
});

test('VisualReviewEvaluator skips visual review when referenceImagePath is not specified', async () => {
  const evaluator = new VisualReviewEvaluator();
  const ctx = createTaskContext({
    taskId: 'vis-task-no-ref',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate home without ref image',
  });

  const result = await evaluator.evaluate(ctx);

  assert.equal(result.passed, true);
  assert.equal(result.type, 'VISUAL_REVIEW');
  assert.match(result.summary, /skipping visual review/i);
  assert.equal(result.errors.length, 0);
});

test('VisualReviewEvaluator returns passed true when all probes pass within tolerance', async () => {
  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    installApp: async () => {},
    launchApp: async () => 1234,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async (): Promise<RefkitBatchReport> => ({
      meanDelta: 3.2,
      passed: true,
      probeResults: [
        {
          probeId: 'bg-fill',
          expected: '#F2F2F7',
          actual: '#F2F2F8',
          delta: 1.2,
          passed: true,
        },
      ],
      worstBands: [],
    }),
    runDiff: async () => ({ meanDelta: 3.2 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task-pass',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate home pass',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });

  const result = await evaluator.evaluate(ctx);

  assert.equal(result.passed, true);
  assert.equal(result.type, 'VISUAL_REVIEW');
  assert.match(result.summary, /acceptable tolerance/i);
  assert.equal(result.meanDelta, 3.2);
});

test('VisualReviewEvaluator populates context paths and invokes simulator methods', async () => {
  const installed: { udid: string; bundle: string }[] = [];
  const launched: { udid: string; bundleId: string }[] = [];
  const screenshots: { udid: string; path: string }[] = [];

  const mockSim: ISimulatorManager = {
    findOrBootDevice: async (name) => `UDID-${name ?? 'DEFAULT'}`,
    installApp: async (udid, appBundlePath) => {
      installed.push({ udid, bundle: appBundlePath });
    },
    launchApp: async (udid, bundleId) => {
      launched.push({ udid, bundleId });
      return 4321;
    },
    takeScreenshot: async (udid, outputPath) => {
      screenshots.push({ udid, path: outputPath });
    },
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async (): Promise<RefkitBatchReport> => ({
      meanDelta: 2.0,
      passed: true,
      probeResults: [],
      worstBands: [],
    }),
    runDiff: async () => ({ meanDelta: 2.0 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task-paths',
    projectPath: '/test/myproject',
    scheme: 'MiniApp',
    taskGoal: 'Replicate home paths',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      preferredDevice: 'iPhone 16 Pro Max',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });
  ctx.appBundlePath = '/tmp/build/MiniApp.app';
  ctx.bundleId = 'com.example.MiniApp';

  await evaluator.evaluate(ctx);

  assert.equal(installed.length, 1);
  assert.equal(installed[0].udid, 'UDID-iPhone 16 Pro Max');
  assert.equal(installed[0].bundle, '/tmp/build/MiniApp.app');
  assert.equal(launched.length, 1);
  assert.equal(launched[0].bundleId, 'com.example.MiniApp');
  assert.equal(screenshots.length, 1);
  assert.match(screenshots[0].path, /simulator-shot\.png$/);
  assert.equal(ctx.capturedScreenshotPath, screenshots[0].path);
  assert.match(ctx.generatedProbesPath ?? '', /probes\.json$/);
});

test('VisualReviewEvaluator respects settleDelayMs configuration', async () => {
  let launchTimestamp = 0;
  let screenshotTimestamp = 0;

  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    installApp: async () => {},
    launchApp: async () => {
      launchTimestamp = Date.now();
      return 1234;
    },
    takeScreenshot: async () => {
      screenshotTimestamp = Date.now();
    },
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async (): Promise<RefkitBatchReport> => ({
      meanDelta: 1.0,
      passed: true,
      probeResults: [],
      worstBands: [],
    }),
    runDiff: async () => ({ meanDelta: 1.0 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task-delay',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Test settle delay',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      settleDelayMs: 50,
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });
  ctx.bundleId = 'com.example.MiniApp';

  await evaluator.evaluate(ctx);

  assert.ok(screenshotTimestamp >= launchTimestamp + 40, 'Screenshot should be taken after settle delay');
});

test('VisualReviewEvaluator fails when probe delta exceeds toleranceMatrix even if passed true in report', async () => {
  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    installApp: async () => {},
    launchApp: async () => 1234,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async (): Promise<RefkitBatchReport> => ({
      meanDelta: 3.0,
      passed: true,
      probeResults: [
        {
          probeId: 'card-inset',
          expected: 16.0,
          actual: 19.5,
          delta: 3.5, // > spacingPtMax 2.0
          passed: true, // erroneously passed by raw refkit
        },
      ],
      worstBands: [],
    }),
    runDiff: async () => ({ meanDelta: 3.0 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task-tol',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Test toleranceMatrix enforcement',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });

  const result = await evaluator.evaluate(ctx);
  assert.equal(result.passed, false);
  assert.equal(result.visualDefects?.length, 1);
  assert.equal(result.visualDefects?.[0].category, 'spacing');
  assert.equal(result.visualDefects?.[0].tolerance, 2.0);
  assert.equal(result.visualDefects?.[0].delta, 3.5);
});

test('VisualReviewEvaluator fails-closed when probe generator throws', async () => {
  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    installApp: async () => {},
    launchApp: async () => 1234,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };
  const mockRefkit: IRefkitBridge = {
    runBatch: async () => ({ meanDelta: 0, passed: true, probeResults: [], worstBands: [] }),
    runDiff: async () => ({ meanDelta: 0 }),
  };
  const failingGenerator: any = {
    generateProbes: async () => {
      throw new Error('Disk IO corrupted or invalid reference image');
    },
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit, failingGenerator);
  const ctx = createTaskContext({
    taskId: 'vis-task-fail-closed',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Test probe failure fail-closed',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });

  const result = await evaluator.evaluate(ctx);
  assert.equal(result.passed, false);
  assert.match(result.summary, /Probe generation failed/);
});

test('VisualReviewEvaluator terminates prior app instance before launch', async () => {
  const actions: string[] = [];
  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    terminateApp: async (_u, bundle) => {
      actions.push(`terminate:${bundle}`);
    },
    installApp: async () => {
      actions.push('install');
    },
    launchApp: async (_u, bundle) => {
      actions.push(`launch:${bundle}`);
      return 1234;
    },
    takeScreenshot: async () => {
      actions.push('screenshot');
    },
  };
  const mockRefkit: IRefkitBridge = {
    runBatch: async () => ({ meanDelta: 1.0, passed: true, probeResults: [], worstBands: [] }),
    runDiff: async () => ({ meanDelta: 1.0 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task-terminate',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Test terminate before launch',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });
  ctx.bundleId = 'com.aire.miniapp';
  ctx.appBundlePath = '/tmp/app.app';

  await evaluator.evaluate(ctx);

  assert.equal(actions[0], 'terminate:com.aire.miniapp');
  assert.equal(actions[1], 'install');
  assert.equal(actions[2], 'launch:com.aire.miniapp');
});
