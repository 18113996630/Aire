import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { OpenCodeCliAdapter } from '../../src/runtime/opencode.adapter.ts';
import { StateMachine } from '../../src/core/state-machine.ts';
import { XcodeBuildEvaluator } from '../../src/evaluator/xcodebuild.ts';
import { createTaskContext } from '../../src/core/context.ts';

describe('OpenCode Live E2E (Layer 3)', () => {
  test('live OpenCode agent workflow on MiniApp', { timeout: 300000 }, async (t) => {
    const adapter = new OpenCodeCliAdapter();
    const available = await adapter.isAvailable();

    if (!available) {
      t.skip('OpenCode CLI is not installed or available in PATH');
      return;
    }

    // In environments where OpenCode binary exists but no AI providers/credentials
    // are configured, headless execution is restricted. Check credential status.
    let hasProvider = false;
    try {
      const binPath = (adapter as any).binPath ?? '/Users/huangrong/.opencode/bin/opencode';
      const authOutput = execSync(`"${binPath}" providers list`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      hasProvider = !authOutput.includes('0 credentials');
    } catch {
      hasProvider = false;
    }

    if (!hasProvider) {
      t.skip('OpenCode CLI has no configured AI providers/credentials in current environment');
      return;
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'aire-e2e-opencode-'));
    try {
      const fixtureDir = fileURLToPath(new URL('../../fixtures/MiniApp', import.meta.url));
      cpSync(fixtureDir, tempDir, { recursive: true });

      execSync('git init -b main', { cwd: tempDir });
      execSync('git config user.name "Aire Tester"', { cwd: tempDir });
      execSync('git config user.email "tester@aire.local"', { cwd: tempDir });
      execSync('git add -A && git commit -m "chore: initial commit"', { cwd: tempDir });

      const context = createTaskContext({
        taskId: 'E2E-OPENCODE-01',
        projectPath: tempDir,
        scheme: 'MiniApp',
        taskGoal: "在 ContentView 居中添加一个显示 'Counter: 0' 的 Text",
        maxRetries: 3
      });

      const evaluator = new XcodeBuildEvaluator();
      const machine = new StateMachine({
        cliAdapter: adapter,
        evaluator,
        skipGit: false
      });

      const finalContext = await machine.run(context);
      assert.equal(finalContext.state, 'COMPLETED');

      const contentView = readFileSync(join(tempDir, 'MiniApp', 'ContentView.swift'), 'utf-8');
      assert.match(contentView, /Counter:\s*0/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
