import fs from 'node:fs/promises';
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
    try {
      await fs.mkdir(artifactDir, { recursive: true });
    } catch {
      // 容错：测试环境或虚拟路径下创建目录失败时不中断评审流程
    }
    const screenshotPath = path.join(artifactDir, 'simulator-shot.png');
    const probesPath = path.join(artifactDir, 'probes.json');
    context.capturedScreenshotPath = screenshotPath;
    context.generatedProbesPath = probesPath;

    // 1. 模拟器运行与截屏
    const udid = await this.simManager.findOrBootDevice(context.visualConfig.preferredDevice);
    if (context.bundleId) {
      await this.simManager.terminateApp(udid, context.bundleId);
    }
    if (context.appBundlePath) {
      await this.simManager.installApp(udid, context.appBundlePath);
    }
    if (context.bundleId) {
      await this.simManager.launchApp(udid, context.bundleId);
      const settleMs = context.visualConfig?.settleDelayMs ?? (process.env.NODE_ENV === 'test' ? 0 : 1500);
      if (settleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, settleMs));
      }
    }
    await this.simManager.takeScreenshot(udid, screenshotPath);

    // 2. 自动生成度量探针
    let actualProbesPath = probesPath;
    let generatedProbes: any[] = [];
    try {
      actualProbesPath = await this.probeGenerator.generateProbes({
        referenceImagePath: context.visualConfig.referenceImagePath,
        renderedImageName: path.basename(screenshotPath),
        scale: 3.0,
        outputPath: probesPath,
        focusAreas: context.visualConfig.focusAreas ? [context.visualConfig.focusAreas] : undefined,
      });
      context.generatedProbesPath = actualProbesPath;

      try {
        const rawJson = await fs.readFile(actualProbesPath, 'utf8');
        generatedProbes = JSON.parse(rawJson);
      } catch {}
    } catch (err: any) {
      return {
        passed: false,
        type: 'VISUAL_REVIEW',
        summary: `Probe generation failed: ${err?.message || String(err)}`,
        errors: [],
        visualDefects: [],
      };
    }

    // 3. 执行 Refkit 批处理度量
    const report = await this.refkitBridge.runBatch(actualProbesPath, artifactDir, 3.0);

    const tolerance = context.visualConfig.toleranceMatrix ?? {
      containerDeltaMax: 7.0,
      spacingPtMax: 2.0,
      textDeltaMax: 15.0,
    };

    // 建立探针元数据索引（实际坐标与命令类型）
    const probeMap = new Map<string, any>();
    for (const p of generatedProbes) {
      if (p.id) probeMap.set(p.id, p);
    }

    const defects: VisualDefect[] = [];

    for (const p of report.probeResults) {
      const probeDef = probeMap.get(p.probeId);
      let category: 'color' | 'spacing' | 'size' | 'layout' = 'color';
      let probeBox: [number, number, number, number] = [0, 0, 100, 100];
      let applicableTolerance = tolerance.containerDeltaMax;

      if (probeDef) {
        if (probeDef.box) {
          probeBox = probeDef.box;
        } else if (probeDef.cmd === 'scan' && probeDef.range && typeof probeDef.at === 'number') {
          probeBox = [probeDef.range[0], probeDef.at, probeDef.range[1], probeDef.at + 1];
        }

        if (probeDef.cmd === 'scan' || p.probeId.includes('inset') || p.probeId.includes('spacing')) {
          category = 'spacing';
          applicableTolerance = tolerance.spacingPtMax;
        } else if (probeDef.cmd === 'bands' || p.probeId.includes('band')) {
          category = 'layout';
          applicableTolerance = tolerance.spacingPtMax;
        } else if (probeDef.cmd === 'bbox' || p.probeId.includes('size')) {
          category = 'size';
          applicableTolerance = tolerance.spacingPtMax;
        } else if (probeDef.only === 'ink' || p.probeId.includes('ink') || p.probeId.includes('text')) {
          category = 'color';
          applicableTolerance = tolerance.textDeltaMax;
        } else {
          category = 'color';
          applicableTolerance = tolerance.containerDeltaMax;
        }
      } else {
        if (p.probeId.includes('inset') || p.probeId.includes('spacing')) {
          category = 'spacing';
          applicableTolerance = tolerance.spacingPtMax;
        } else if (p.probeId.includes('ink') || p.probeId.includes('text')) {
          category = 'color';
          applicableTolerance = tolerance.textDeltaMax;
        } else if (p.probeId.includes('band')) {
          category = 'layout';
          applicableTolerance = tolerance.spacingPtMax;
        } else if (p.probeId.includes('size')) {
          category = 'size';
          applicableTolerance = tolerance.spacingPtMax;
        }
      }

      const isDefect = !p.passed || p.delta > applicableTolerance;

      if (isDefect) {
        defects.push({
          id: p.probeId,
          severity: p.delta > applicableTolerance * 2 ? 'critical' : 'high',
          category,
          element: p.probeId,
          probeBox,
          expected: p.expected,
          actual: p.actual,
          delta: p.delta,
          tolerance: applicableTolerance,
          claim: `Probe ${p.probeId} measured ${p.actual}, expected ${p.expected} (delta ${p.delta}, tolerance ${applicableTolerance}).`,
        });
      }
    }

    const meanExceeded = report.meanDelta > tolerance.containerDeltaMax;
    if (defects.length > 0 || !report.passed || meanExceeded) {
      return {
        passed: false,
        type: 'VISUAL_REVIEW',
        summary: `${defects.length} visual defects identified in simulator rendering (mean Δ: ${report.meanDelta.toFixed(1)}, max allowed: ${tolerance.containerDeltaMax}).`,
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
