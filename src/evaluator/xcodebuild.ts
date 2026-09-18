import * as path from 'node:path';
import * as fs from 'node:fs/promises';
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

export interface XcodeBuildEvaluatorOptions {
  runner?: ProcessRunner;
  derivedDataPath?: string;
  bundleIdResolver?: (appBundlePath: string) => Promise<string | null>;
}

export class XcodeBuildEvaluator implements IEvaluator {
  readonly name = 'XcodeBuild';
  private runner: ProcessRunner;
  private customDerivedDataPath?: string;
  private bundleIdResolver?: (appBundlePath: string) => Promise<string | null>;

  constructor(options?: XcodeBuildEvaluatorOptions) {
    this.runner = options?.runner ?? defaultProcessRunner;
    this.customDerivedDataPath = options?.derivedDataPath;
    this.bundleIdResolver = options?.bundleIdResolver;
  }

  private async resolveBundleId(appPath: string): Promise<string | null> {
    if (this.bundleIdResolver) {
      try {
        const id = await this.bundleIdResolver(appPath);
        if (id) return id;
      } catch {}
    }

    const plistPath = path.join(appPath, 'Info.plist');
    try {
      const plutilRes = await this.runner({
        command: 'plutil',
        args: ['-extract', 'CFBundleIdentifier', 'raw', plistPath],
        cwd: path.dirname(appPath),
      });
      if (plutilRes.exitCode === 0 && plutilRes.stdout.trim()) {
        return plutilRes.stdout.trim();
      }
    } catch {}

    try {
      const content = await fs.readFile(plistPath, 'utf8');
      const match = content.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
      if (match) return match[1];
    } catch {}

    return null;
  }

  private async findAppBundle(productsDir: string, scheme: string): Promise<string> {
    const directPath = path.join(productsDir, `${scheme}.app`);
    try {
      const stat = await fs.stat(directPath);
      if (stat.isDirectory()) return directPath;
    } catch {}

    try {
      const entries = await fs.readdir(productsDir);
      const appEntry = entries.find((e) => e.endsWith('.app'));
      if (appEntry) {
        return path.join(productsDir, appEntry);
      }
    } catch {}

    return directPath;
  }

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    const derivedData = this.customDerivedDataPath ?? path.join(context.projectPath, '.aire', 'build');
    const args = [
      '-scheme', context.scheme,
      '-destination', 'generic/platform=iOS Simulator',
      '-derivedDataPath', derivedData,
      'clean', 'build'
    ];

    try {
      const result = await this.runner({
        command: 'xcodebuild',
        args,
        cwd: context.projectPath
      });

      if (result.exitCode === 0) {
        const productsDir = path.join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator');
        const appPath = await this.findAppBundle(productsDir, context.scheme);
        context.appBundlePath = appPath;

        const extractedBundleId = await this.resolveBundleId(appPath);
        context.bundleId = extractedBundleId ?? context.bundleId ?? `com.example.${context.scheme}`;

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
