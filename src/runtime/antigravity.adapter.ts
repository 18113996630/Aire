/**
 * AIRE Antigravity CLI Runtime Adapter
 *
 * Implements ICliAdapter using the Google Antigravity CLI (`agy`).
 * Used by StateMachine / TaskRunner to execute iterative code modifications.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from './adapter.interface.ts';

export class AntigravityCliAdapter implements ICliAdapter {
  readonly name = 'Antigravity';
  private binPath: string;

  constructor(binPath?: string) {
    this.binPath = binPath ?? process.env.AGY_BIN ?? 'agy';
  }

  private async resolveBin(): Promise<string> {
    if (this.binPath && this.binPath !== 'agy') {
      return this.binPath;
    }

    const candidatePaths = [
      process.env.AGY_BIN,
      '/Users/huangrong/.local/bin/agy',
      path.join(os.homedir(), '.local/bin/agy'),
      '/usr/local/bin/agy',
      '/opt/homebrew/bin/agy',
    ].filter(Boolean) as string[];

    for (const candidate of candidatePaths) {
      try {
        await fs.access(candidate);
        this.binPath = candidate;
        return candidate;
      } catch {
        // continue
      }
    }

    return this.binPath;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const bin = await this.resolveBin();
      return new Promise((resolve) => {
        const child = spawn(bin, ['--help']);
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
      });
    } catch {
      return false;
    }
  }

  async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
    const bin = await this.resolveBin();
    const start = Date.now();
    const timeout = params.timeoutMs ?? 300000; // 5 minutes timeout

    return new Promise((resolve, reject) => {
      const child = spawn(
        bin,
        ['-p', params.prompt, '--dangerously-skip-permissions'],
        {
          cwd: params.cwd,
        }
      );

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Antigravity CLI (agy) timed out after ${timeout}ms`));
      }, timeout);

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

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}
