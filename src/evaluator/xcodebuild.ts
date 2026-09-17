import { spawn } from 'node:child_process';
import type { TaskContext, EvaluationResult } from '../core/types.ts';
import type { IEvaluator } from './evaluator.interface.ts';
import { parseSwiftErrors } from './swift-error-parser.ts';

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}) => Promise<ProcessRunResult>;

export const defaultProcessRunner: ProcessRunner = ({ command, args, cwd, timeoutMs = 180000 }) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
};

export class XcodeBuildEvaluator implements IEvaluator {
  readonly name = 'XcodeBuild';
  private runner: ProcessRunner;

  constructor(options?: { runner?: ProcessRunner }) {
    this.runner = options?.runner ?? defaultProcessRunner;
  }

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    const args = [
      '-scheme', context.scheme,
      '-destination', 'generic/platform=iOS Simulator',
      'clean', 'build'
    ];

    try {
      const result = await this.runner({
        command: 'xcodebuild',
        args,
        cwd: context.projectPath
      });

      if (result.exitCode === 0) {
        return {
          passed: true,
          type: 'BUILD',
          summary: 'Build succeeded cleanly',
          errors: []
        };
      }

      const combinedLog = result.stdout + '\n' + result.stderr;
      const errors = parseSwiftErrors(combinedLog);

      return {
        passed: false,
        type: 'BUILD',
        summary: errors.length > 0
          ? `Build failed with ${errors.length} compiler error(s)`
          : `Build failed with exit code ${result.exitCode}`,
        errors
      };
    } catch (err: any) {
      return {
        passed: false,
        type: 'BUILD',
        summary: `xcodebuild execution error: ${err.message}`,
        errors: []
      };
    }
  }
}
