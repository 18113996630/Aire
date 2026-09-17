import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { StateMachine } from '../../src/core/state-machine.ts';
import { createTaskContext } from '../../src/core/context.ts';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';
import { XcodeBuildEvaluator } from '../../src/evaluator/xcodebuild.ts';
import { GitManager } from '../../src/vcs/git-manager.ts';

describe('Fix Loop Integration (Layer 2)', () => {
  let tempDir: string;
  let contentViewPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aire-int-test-'));
    const fixtureDir = fileURLToPath(new URL('../../fixtures/MiniApp', import.meta.url));
    cpSync(fixtureDir, tempDir, { recursive: true });

    contentViewPath = join(tempDir, 'MiniApp', 'ContentView.swift');

    execSync('git init -b main', { cwd: tempDir });
    execSync('git config user.name "Aire Tester"', { cwd: tempDir });
    execSync('git config user.email "tester@aire.local"', { cwd: tempDir });
    execSync('git add -A && git commit -m "chore: initial commit"', { cwd: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('successfully triggers fix loop when Round 1 fails compilation and Round 2 fixes it', { timeout: 120000 }, async () => {
    const brokenCode = `import SwiftUI

public struct ContentView: View {
    public init() {}
    public var body: some View {
        VStack {
            Text("MiniApp Initial State")
            InvalidButtonView()
        }
        .padding()
    }
}
`;

    const fixedCode = `import SwiftUI

public struct ContentView: View {
    public init() {}
    public var body: some View {
        VStack {
            Text("Fixed Successfully")
        }
        .padding()
    }
}
`;

    const mockCli = new MockCliAdapter([
      async () => {
        writeFileSync(contentViewPath, brokenCode, 'utf-8');
        return {
          exitCode: 0,
          stdout: 'Injected broken code into ContentView.swift',
          stderr: '',
          durationMs: 10
        };
      },
      async () => {
        writeFileSync(contentViewPath, fixedCode, 'utf-8');
        return {
          exitCode: 0,
          stdout: 'Injected fixed code into ContentView.swift',
          stderr: '',
          durationMs: 10
        };
      }
    ]);

    const evaluator = new XcodeBuildEvaluator();
    const gitManager = new GitManager(tempDir);

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator,
      skipGit: false
    });

    const context = createTaskContext({
      taskId: 'T-INT-FIX-01',
      projectPath: tempDir,
      scheme: 'MiniApp',
      taskGoal: 'Replace button with valid text',
      maxRetries: 3
    });

    const finalContext = await machine.run(context);

    // 1. Final state is COMPLETED
    assert.equal(finalContext.state, 'COMPLETED');

    // 2. Exactly 2 iterations recorded
    assert.equal(finalContext.history.length, 2);

    // 3. Round 1 evaluation failed and captured Swift compiler error
    const round1Eval = finalContext.history[0]?.evaluationResult;
    assert.ok(round1Eval, 'Round 1 evaluationResult must exist');
    assert.equal(round1Eval.passed, false);
    assert.equal(round1Eval.type, 'BUILD');
    assert.ok(round1Eval.errors.length > 0);
    assert.ok(
      round1Eval.errors.some(
        (err) => err.file.includes('ContentView.swift') && err.message.includes('InvalidButtonView')
      ),
      `Expected compiler error on ContentView.swift referencing InvalidButtonView, got: ${JSON.stringify(round1Eval.errors)}`
    );

    // 4. Round 2 evaluation passed cleanly
    const round2Eval = finalContext.history[1]?.evaluationResult;
    assert.ok(round2Eval, 'Round 2 evaluationResult must exist');
    assert.equal(round2Eval.passed, true);
    assert.equal(round2Eval.type, 'BUILD');
    assert.equal(round2Eval.errors.length, 0);

    // 5. Final file content matches fixed code
    const finalContent = readFileSync(contentViewPath, 'utf-8');
    assert.match(finalContent, /Fixed Successfully/);

    // 6. Real Git commit was generated and working tree is clean
    assert.equal(await gitManager.isClean(), true);
    const gitLog = execSync('git log -n 1 --pretty=format:%s', { cwd: tempDir }).toString();
    assert.equal(gitLog, 'feat(aire): Replace button with valid text');
  });
});
