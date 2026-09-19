/**
 * AIRE XCUITest Driver
 *
 * Implements primary in-process interaction channel via Apple XCUITest harness runner.
 * Manages Apple standard test runner environment variables, xcodebuild CLI execution,
 * and artifact report extraction.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlowExecutionReport } from './types.ts';

const execFileAsync = promisify(execFile);

export type ExecProcessFn = (
  cmd: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; cwd?: string }
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecProcessFn: ExecProcessFn = async (cmd, args, options) => {
  const result = await execFileAsync(cmd, args, {
    env: { ...process.env, ...options?.env },
    cwd: options?.cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

export interface XCUITestDriverOptions {
  projectPath: string;
  scheme?: string;
  udid?: string;
  derivedDataPath?: string;
  execFn?: ExecProcessFn;
}

export class XCUITestDriver {
  readonly name = 'XCUITestDriver';
  readonly projectPath: string;
  readonly scheme: string;
  readonly udid: string;
  readonly derivedDataPath?: string;
  private execFn: ExecProcessFn;

  constructor(options: XCUITestDriverOptions) {
    this.projectPath = options.projectPath;
    this.scheme = options.scheme ?? 'AIREUITests';
    this.udid = options.udid ?? 'booted';
    this.derivedDataPath = options.derivedDataPath;
    this.execFn = options.execFn ?? defaultExecProcessFn;
  }

  buildTestRunnerEnvs(
    flowFilePath: string,
    artifactDir: string,
    startStepId?: string
  ): Record<string, string> {
    const envs: Record<string, string> = {
      TEST_RUNNER_FLOW_FILE_PATH: flowFilePath,
      TEST_RUNNER_ARTIFACT_DIR: artifactDir,
    };
    if (startStepId) {
      envs.TEST_RUNNER_START_STEP_ID = startStepId;
    }
    return envs;
  }

  buildXcodebuildCommand(options?: { testMethod?: string }): { cmd: string; args: string[] } {
    const testMethod = options?.testMethod ?? 'testRunFlow';
    const args = [
      'xcodebuild',
      'test',
      '-project',
      this.projectPath,
      '-scheme',
      this.scheme,
      '-destination',
      `id=${this.udid}`,
      `-only-testing:${this.scheme}/FlowTestRunner/${testMethod}`,
    ];

    if (this.derivedDataPath) {
      args.push('-derivedDataPath', this.derivedDataPath);
    }

    return {
      cmd: 'xcrun',
      args,
    };
  }

  async executeFlowBatch(options: {
    flowFilePath: string;
    artifactDir: string;
    startStepId?: string;
    testMethod?: string;
  }): Promise<FlowExecutionReport> {
    const startTime = Date.now();
    await fs.mkdir(options.artifactDir, { recursive: true });

    const envs = this.buildTestRunnerEnvs(
      options.flowFilePath,
      options.artifactDir,
      options.startStepId
    );
    const { cmd, args } = this.buildXcodebuildCommand({ testMethod: options.testMethod });

    let execError: any = null;
    let output = { stdout: '', stderr: '' };

    try {
      output = await this.execFn(cmd, args, {
        env: envs,
        cwd: path.dirname(this.projectPath),
      });
    } catch (err: any) {
      execError = err;
      output = {
        stdout: err?.stdout || '',
        stderr: err?.stderr || String(err),
      };
    }

    // Inspect artifact report written by Swift FlowTestRunner
    const reportPath = path.join(options.artifactDir, 'flow-report.json');
    try {
      const rawReport = await fs.readFile(reportPath, 'utf8');
      const parsed = JSON.parse(rawReport) as FlowExecutionReport;
      return parsed;
    } catch {
      // If artifact report wasn't generated (e.g. build failure or test runner crash)
      const flowId = path.basename(options.flowFilePath, path.extname(options.flowFilePath));
      return {
        flowId,
        success: false,
        totalDurationMs: Date.now() - startTime,
        completedSteps: 0,
        totalSteps: 0,
        stepReports: [],
        error:
          execError?.message ??
          `XCUITest execution did not produce flow-report.json. Output: ${output.stderr || output.stdout}`,
      };
    }
  }
}
