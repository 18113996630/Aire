import { spawn } from 'node:child_process';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from './adapter.interface.ts';

export class OpenCodeCliAdapter implements ICliAdapter {
  readonly name = 'OpenCode';
  private binPath: string;

  constructor(binPath?: string) {
    this.binPath = binPath ?? process.env.OPENCODE_BIN ?? 'opencode';
  }

  async isAvailable(): Promise<boolean> {
    const testBin = (bin: string): Promise<boolean> =>
      new Promise((resolve) => {
        const child = spawn(bin, ['--version']);
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
      });

    if (await testBin(this.binPath)) {
      return true;
    }

    if (this.binPath === 'opencode' && process.env.HOME) {
      const fallback = `${process.env.HOME}/.opencode/bin/opencode`;
      if (await testBin(fallback)) {
        this.binPath = fallback;
        return true;
      }
    }

    return false;
  }

  async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
    const start = Date.now();
    const timeout = params.timeoutMs ?? 300000; // 5 分钟超时

    return new Promise((resolve, reject) => {
      // 使用 prompt 模式调用 opencode
      const child = spawn(this.binPath, ['run', params.prompt], {
        cwd: params.cwd
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`OpenCode timed out after ${timeout}ms`));
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

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - start
        });
      });
    });
  }
}
