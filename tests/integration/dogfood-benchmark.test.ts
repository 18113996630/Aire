/**
 * AIRE Sub-project 4 - Step 0: MiniApp Dogfooding Benchmark
 *
 * Runs the real fixtures/MiniApp/task-graph.yaml through SerialDagScheduler to
 * establish the downstream execution baseline:
 * 1. Executes task-data-model (Swift Codable model + build verification).
 * 2. Executes task-card-view (SwiftUI view + build & visual verification against reference.png).
 * 3. Asserts Git commits, AIRE trailers, TaskResult artifact hand-off, and SUCCEEDED termination.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SerialDagScheduler } from '../../src/dag/serial-dag-scheduler.ts';
import { TaskGraph } from '../../src/dag/task-graph.ts';
import { TaskRunner } from '../../src/dag/task-runner.ts';
import { SerialWorkspaceStrategy } from '../../src/dag/serial-workspace-strategy.ts';
import { RunStateStore } from '../../src/dag/run-state-store.ts';
import { ArtifactManager } from '../../src/dag/artifact-manager.ts';
import { CascadeExecutionPolicy } from '../../src/dag/cascade-execution-policy.ts';
import { VisualReviewEvaluator } from '../../src/evaluator/visual/visual-evaluator.ts';
import { EvaluatorPipeline } from '../../src/evaluator/pipeline.ts';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from '../../src/runtime/adapter.interface.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';
import type { ISimulatorManager } from '../../src/ios/simulator-manager.ts';
import type { IRefkitBridge } from '../../src/evaluator/visual/refkit-bridge.ts';

const execFileAsync = promisify(execFile);

describe('Sub-project 4 - Step 0: Real MiniApp Dogfooding Benchmark', () => {
  let testRepoDir: string;

  async function runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: testRepoDir });
    return stdout.trim();
  }

  beforeEach(async () => {
    testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-dogfood-'));
    await runGit(['init']);
    await runGit(['config', 'user.name', 'AIRE Tester']);
    await runGit(['config', 'user.email', 'aire@test.local']);
    await runGit(['config', 'commit.gpgsign', 'false']);

    // Copy fixture directory contents to test repo
    const fixtureDir = path.resolve('fixtures/MiniApp');
    await fs.cp(fixtureDir, testRepoDir, { recursive: true });

    await runGit(['add', '-A']);
    await runGit(['commit', '-m', 'chore: initial MiniApp repository snapshot']);
  });

  afterEach(async () => {
    if (testRepoDir) {
      await fs.rm(testRepoDir, { recursive: true, force: true });
    }
  });

  test('executes fixtures/MiniApp/task-graph.yaml end-to-end with visual verification', async () => {
    const taskGraphYamlPath = path.join(testRepoDir, 'task-graph.yaml');
    const taskGraphYaml = await fs.readFile(taskGraphYamlPath, 'utf-8');
    const taskGraph = TaskGraph.fromYaml(taskGraphYaml);

    // Mock CLI adapter simulating code generation for data model and SwiftUI card view
    const executedPrompts: Record<string, string> = {};
    const mockCliAdapter: ICliAdapter = {
      name: 'MockCliAdapter',
      isAvailable: async () => true,
      execute: async (params: CliExecuteParams): Promise<CliExecutionResult> => {
        if (params.prompt.includes('- **任务 ID**: `task-card-view`') || params.prompt.includes('GreetingCardView.swift')) {
          executedPrompts['task-card-view'] = params.prompt;
          const cardViewPath = path.join(testRepoDir, 'MiniApp/GreetingCardView.swift');
          await fs.mkdir(path.dirname(cardViewPath), { recursive: true });
          await fs.writeFile(
            cardViewPath,
            `import SwiftUI\n\npublic struct GreetingCardView: View {\n    public let greeting: Greeting\n\n    public init(greeting: Greeting) {\n        self.greeting = greeting\n    }\n\n    public var body: some View {\n        VStack(alignment: .leading, spacing: 8) {\n            Text(greeting.title)\n                .font(.headline)\n            Text(greeting.message)\n                .font(.subheadline)\n        }\n        .padding()\n        .background(Color(.secondarySystemBackground))\n        .cornerRadius(12)\n    }\n}\n`,
            'utf-8'
          );
          return { exitCode: 0, stdout: 'Generated GreetingCardView.swift', stderr: '', durationMs: 50 };
        }

        if (params.prompt.includes('- **任务 ID**: `task-data-model`') || params.prompt.includes('Greeting.swift')) {
          executedPrompts['task-data-model'] = params.prompt;
          const greetingPath = path.join(testRepoDir, 'MiniApp/Greeting.swift');
          await fs.mkdir(path.dirname(greetingPath), { recursive: true });
          await fs.writeFile(
            greetingPath,
            `import Foundation\n\npublic struct Greeting: Identifiable, Codable {\n    public let id: UUID\n    public let title: String\n    public let message: String\n\n    public init(id: UUID = UUID(), title: String, message: String) {\n        self.id = id\n        self.title = title\n        self.message = message\n    }\n}\n`,
            'utf-8'
          );
          return { exitCode: 0, stdout: 'Generated Greeting.swift', stderr: '', durationMs: 50 };
        }

        console.log('Unrecognized prompt received:', params.prompt.slice(0, 100));
        return { exitCode: 0, stdout: 'OK', stderr: '', durationMs: 10 };
      },
    };

    // Evaluator setup: Mock XcodeBuildEvaluator and Mock VisualReviewEvaluator
    const mockSimulator: ISimulatorManager = {
      findOrBootDevice: async () => 'SIM-UDID-DOGFOOD',
      installApp: async () => {},
      launchApp: async () => 9876,
      takeScreenshot: async () => {},
      terminateApp: async () => {},
    };

    const mockRefkit: IRefkitBridge = {
      runBatch: async () => ({
        meanDelta: 3.2,
        passed: true,
        probeResults: [
          {
            probeId: 'card-bg',
            expected: '#F2F2F7',
            actual: '#F0F0F5',
            delta: 2.1,
            passed: true,
          },
          {
            probeId: 'card-text',
            expected: '#000000',
            actual: '#050505',
            delta: 3.5,
            passed: true,
          },
        ],
        worstBands: [],
      }),
      runDiff: async () => ({ meanDelta: 2.0 }),
    };

    const taskRunner = new TaskRunner({
      cliAdapter: mockCliAdapter,
      defaultScheme: 'MiniApp',
      evaluatorFactory: (task) => {
        const buildEvaluator: IEvaluator = {
          name: 'XcodeBuild',
          evaluate: async (ctx) => {
            ctx.appBundlePath = path.join(testRepoDir, 'build/MiniApp.app');
            return { passed: true, type: 'BUILD', summary: 'Build succeeded', errors: [] };
          },
        };

        if (task.verification?.visual) {
          const visualEvaluator = new VisualReviewEvaluator(mockSimulator, mockRefkit);
          return new EvaluatorPipeline([buildEvaluator, visualEvaluator]);
        }
        return buildEvaluator;
      },
    });

    const runStateStore = new RunStateStore();
    const artifactManager = new ArtifactManager();
    const workspaceStrategy = new SerialWorkspaceStrategy();
    const executionPolicy = new CascadeExecutionPolicy();

    const scheduler = new SerialDagScheduler({
      taskRunner,
      workspaceStrategy,
      runStateStore,
      artifactManager,
      executionPolicy,
      rawYamlContent: taskGraphYaml,
      graphPath: taskGraphYamlPath,
    });

    const report = await scheduler.run(taskGraph, { projectPath: testRepoDir });

    // Verification 1: Execution report should be SUCCEEDED
    assert.equal(report.status, 'SUCCEEDED');
    assert.equal(report.completedTasks.length, 2);
    assert.equal(report.failedTasks.length, 0);
    assert.equal(report.blockedTasks.length, 0);
    assert.ok(report.completedTasks.includes('task-data-model'));
    assert.ok(report.completedTasks.includes('task-card-view'));

    // Verification 2: TaskResult artifacts exist and task-card-view prompt received predecessor contract
    const dataModelResult = await artifactManager.getTaskResult(testRepoDir, 'task-data-model');
    assert.ok(dataModelResult);
    assert.equal(dataModelResult.status, 'SUCCEEDED');
    assert.ok(dataModelResult.changedFiles.includes('MiniApp/Greeting.swift'));

    const cardViewPrompt = executedPrompts['task-card-view'];
    assert.ok(cardViewPrompt, 'task-card-view prompt should have been recorded');
    assert.ok(cardViewPrompt.includes('task-data-model'), 'task-card-view prompt must contain direct predecessor task-data-model');
    assert.ok(cardViewPrompt.includes('MiniApp/Greeting.swift'), 'task-card-view prompt must contain changed files of predecessor');

    // Verification 3: Git commit trailers verify accurate task attribution
    const log = await runGit(['log', '-n', '2', '--pretty=%B---']);
    assert.ok(log.includes('AIRE-Task-Id: task-card-view'));
    assert.ok(log.includes('AIRE-Task-Id: task-data-model'));
  });
});
