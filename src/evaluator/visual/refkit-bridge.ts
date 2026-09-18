import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProbeExecutionResult {
  probeId: string;
  expected: string | number;
  actual: string | number;
  delta: number;
  passed: boolean;
}

export interface RefkitBatchReport {
  meanDelta: number;
  passed: boolean;
  probeResults: ProbeExecutionResult[];
  worstBands: Array<{
    y0: number;
    y1: number;
    delta: number;
    mineHex: string;
    refHex: string;
  }>;
}

export type UvRunFn = (args: string[]) => Promise<string>;

export interface IRefkitBridge {
  runBatch(probesJsonPath: string, againstDir: string, scale: number): Promise<RefkitBatchReport>;
  runDiff(mineImage: string, refImage: string): Promise<{ meanDelta: number }>;
}

export class RefkitBridge implements IRefkitBridge {
  private uvPath: string;
  private refkitPyPath: string;
  private runner?: UvRunFn;

  constructor(
    uvPath = '/Users/huangrong/.local/bin/uv',
    refkitPyPath = 'tools/refkit.py',
    runner?: UvRunFn
  ) {
    this.uvPath = uvPath;
    this.refkitPyPath = refkitPyPath;
    this.runner = runner;
  }

  private async execute(args: string[]): Promise<string> {
    if (this.runner) {
      return this.runner(args);
    }
    const { stdout } = await execFileAsync(this.uvPath, [
      'run',
      '--with',
      'pillow',
      '--with',
      'numpy',
      this.refkitPyPath,
      ...args,
    ]);
    return stdout;
  }

  async runBatch(probesJsonPath: string, againstDir: string, scale: number): Promise<RefkitBatchReport> {
    const rawOutput = await this.execute([
      'batch',
      probesJsonPath,
      '--against',
      againstDir,
      '--pt',
      scale.toString(),
    ]);

    const lines = rawOutput.split('\n');
    const probeResults: ProbeExecutionResult[] = [];
    let meanDelta = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const meanMatch = trimmed.match(/^mean Δ\s+([\d.]+)/);
      if (meanMatch) {
        meanDelta = parseFloat(meanMatch[1]);
        continue;
      }

      // 匹配表格行：probe ref mine delta (<-- off)? 或 differs / ERROR
      const parts = trimmed.split(/\s+/);
      if (
        parts.length >= 3 &&
        parts[0] !== 'probe' &&
        parts[0] !== 'id' &&
        parts[0] !== 'mean' &&
        parts[0] !== 'colour' &&
        parts[0] !== 'box' &&
        !trimmed.startsWith('--')
      ) {
        const id = parts[0];
        const refVal = parts[1];
        const mineVal = parts[2];
        const hasDiffers = trimmed.includes('differs');
        const hasError = trimmed.includes('ERROR:');
        const isOff = trimmed.includes('<-- off');
        const delta = parts[3] && !isNaN(parseFloat(parts[3])) ? parseFloat(parts[3]) : (hasDiffers ? 999.0 : 0);
        const passed = !isOff && !hasDiffers && !hasError;
        probeResults.push({
          probeId: id,
          expected: isNaN(Number(refVal)) ? refVal : Number(refVal),
          actual: isNaN(Number(mineVal)) ? mineVal : Number(mineVal),
          delta,
          passed,
        });
      }
    }

    const allPassed = probeResults.every((p) => p.passed) && meanDelta <= 7.0;

    return {
      meanDelta,
      passed: allPassed,
      probeResults,
      worstBands: [],
    };
  }

  async runDiff(mineImage: string, refImage: string): Promise<{ meanDelta: number }> {
    const rawOutput = await this.execute(['diff', mineImage, refImage]);
    const match = rawOutput.match(/mean Δ\s+([\d.]+)/);
    const meanDelta = match ? parseFloat(match[1]) : 0;
    return { meanDelta };
  }
}
