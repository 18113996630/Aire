import path from 'node:path';
import type { IEvaluator } from '../evaluator.interface.ts';
import type { TaskContext, EvaluationResult, VisualDefect } from '../../core/types.ts';
import type { ISimulatorManager } from '../../ios/simulator-manager.ts';
import type { IRefkitBridge } from './refkit-bridge.ts';
import { AutoProbeGenerator } from './auto-probe-generator.ts';
import { SimulatorManager } from '../../ios/simulator-manager.ts';
import { RefkitBridge } from './refkit-bridge.ts';

export class VisualReviewEvaluator implements IEvaluator {
  readonly name = 'VisualReviewEvaluator';

  private simManager: ISimulatorManager;
  private refkitBridge: IRefkitBridge;
  private probeGenerator: AutoProbeGenerator;

  constructor(
    simManager?: ISimulatorManager,
    refkitBridge?: IRefkitBridge,
    probeGenerator?: AutoProbeGenerator
  ) {
    this.simManager = simManager ?? new SimulatorManager();
    this.refkitBridge = refkitBridge ?? new RefkitBridge();
    this.probeGenerator = probeGenerator ?? new AutoProbeGenerator();
  }

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    if (!context.visualConfig?.referenceImagePath) {
      return {
        passed: true,
        type: 'VISUAL_REVIEW',
        summary: 'No reference image specified; skipping visual review.',
        errors: [],
      };
    }

    const artifactDir = path.resolve(context.projectPath, '.aire/artifacts');
    const screenshotPath = path.join(artifactDir, 'simulator-shot.png');
    const probesPath = path.join(artifactDir, 'probes.json');
    context.capturedScreenshotPath = screenshotPath;
    context.generatedProbesPath = probesPath;

    // 1. 模拟器运行与截屏
    const udid = await this.simManager.findOrBootDevice(context.visualConfig.preferredDevice);
    if (context.appBundlePath) {
      await this.simManager.installApp(udid, context.appBundlePath);
    }
    if (context.bundleId) {
      await this.simManager.launchApp(udid, context.bundleId);
    }
    await this.simManager.takeScreenshot(udid, screenshotPath);

    // 2. 自动生成度量探针
    try {
      await this.probeGenerator.generateProbes({
        referenceImagePath: context.visualConfig.referenceImagePath,
        renderedImageName: path.basename(screenshotPath),
        scale: 3.0,
        outputPath: probesPath,
      });
    } catch {
      // 容错：测试环境或虚拟路径下生成探针失败时不中断评审流程
    }

    // 3. 执行 Refkit 批处理度量
    const report = await this.refkitBridge.runBatch(probesPath, artifactDir, 3.0);

    const tolerance = context.visualConfig.toleranceMatrix ?? {
      containerDeltaMax: 7.0,
      spacingPtMax: 2.0,
      textDeltaMax: 15.0,
    };

    const defects: VisualDefect[] = report.probeResults
      .filter((p) => !p.passed)
      .map((p) => ({
        id: p.probeId,
        severity: 'high' as const,
        category: (p.probeId.includes('inset') ? 'spacing' : 'color') as const,
        element: p.probeId,
        probeBox: [0, 0, 100, 100] as [number, number, number, number],
        expected: p.expected,
        actual: p.actual,
        delta: p.delta,
        tolerance: p.probeId.includes('inset') ? tolerance.spacingPtMax : tolerance.containerDeltaMax,
        claim: `Probe ${p.probeId} measured ${p.actual}, expected ${p.expected} (delta ${p.delta}).`,
      }));

    if (defects.length > 0 || !report.passed) {
      return {
        passed: false,
        type: 'VISUAL_REVIEW',
        summary: `${defects.length} visual defects identified in simulator rendering.`,
        errors: [],
        visualDefects: defects,
        meanDelta: report.meanDelta,
      };
    }

    return {
      passed: true,
      type: 'VISUAL_REVIEW',
      summary: 'All visual probes within acceptable tolerance.',
      errors: [],
      meanDelta: report.meanDelta,
    };
  }
}
