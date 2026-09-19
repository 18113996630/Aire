/**
 * AIRE Antigravity CLI Agent Model
 *
 * Implements IAgentModel using the Google Antigravity CLI (`agy`).
 * Runs non-interactively via `agy -p <prompt> --dangerously-skip-permissions --output-format json`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IAgentModel, AgentModelOptions } from './agent-model.interface.ts';

const execFileAsync = promisify(execFile);

export class AntigravityAgentModel implements IAgentModel {
  readonly name = 'AntigravityAgentModel';
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
      const { stdout, stderr } = await execFileAsync(bin, ['--help'], { timeout: 3000 });
      return (stdout + stderr).toLowerCase().includes('usage of agy') || (stdout + stderr).includes('agy');
    } catch {
      return false;
    }
  }

  async generateStructured<T>(prompt: string, schema?: object, options?: AgentModelOptions): Promise<T> {
    const bin = await this.resolveBin();
    const timeoutMs = options?.timeoutMs ?? 15000;

    const fullPrompt = `${prompt}

IMPORTANT: You MUST reply with pure, valid JSON conforming to the requested schema. Do not enclose in backticks or markdown if possible. If you must use code blocks, use \`\`\`json ... \`\`\`.`;

    const args = ['-p', fullPrompt, '--dangerously-skip-permissions', '--output-format', 'json'];
    if (options?.model) {
      args.push('--model', options.model);
    }

    const { stdout } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Parse agy output format JSON
    let responseText = stdout;
    try {
      const parsedCliOutput = JSON.parse(stdout);
      if (parsedCliOutput.response && typeof parsedCliOutput.response === 'string') {
        responseText = parsedCliOutput.response;
      }
    } catch {
      // stdout may already be raw output
    }

    // Strip markdown code fences if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch (err: any) {
      // Extract the first JSON object or array match if surrounded by text
      const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (match) {
        return JSON.parse(match[1]) as T;
      }
      throw new Error(`Failed to parse structured JSON from Antigravity CLI output: ${err.message}\nRaw: ${cleaned.slice(0, 300)}`);
    }
  }
}
