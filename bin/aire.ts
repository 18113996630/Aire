#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createTaskContext } from '../src/core/context.ts';
import { StateMachine } from '../src/core/state-machine.ts';
import { OpenCodeCliAdapter } from '../src/runtime/opencode.adapter.ts';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from '../src/runtime/adapter.interface.ts';
import { XcodeBuildEvaluator } from '../src/evaluator/xcodebuild.ts';
import { EvaluatorPipeline } from '../src/evaluator/pipeline.ts';
import { VisualReviewEvaluator } from '../src/evaluator/visual/visual-evaluator.ts';
import type { IEvaluator } from '../src/evaluator/evaluator.interface.ts';
import { TaskGraph } from '../src/dag/task-graph.ts';
import { SerialDagScheduler } from '../src/dag/serial-dag-scheduler.ts';
import { TaskRunner } from '../src/dag/task-runner.ts';
import type { TaskNode, DagExecutionReport } from '../src/dag/types.ts';
import { PlannerOrchestrator } from '../src/planner/planner-orchestrator.ts';

const program = new Command();

function createCliTaskRunner(): TaskRunner | undefined {
  if (process.env.AIRE_MOCK_RUNNER === '1' || process.env.AIRE_MOCK_RUNNER === 'true') {
    const mockCli: ICliAdapter = {
      name: 'MockCliAdapter',
      async isAvailable() {
        return true;
      },
      async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
        const allowedFilesSection = params.prompt.match(
          /- \*\*允许修改的文件清单（Allowed Files）\*\*:\n((?:\s+- `[^`]+`\n?)+)/
        );
        if (allowedFilesSection) {
          const files = [...allowedFilesSection[1].matchAll(/- `([^`]+)`/g)].map((m) => m[1]);
          for (const relFile of files) {
            if (relFile === '(无限制)') continue;
            const fullPath = resolve(params.cwd, relFile);
            await fs.mkdir(dirname(fullPath), { recursive: true });
            await fs.writeFile(
              fullPath,
              `// Auto-generated mock implementation\n`,
              'utf-8'
            );
          }
        }
        return {
          exitCode: 0,
          stdout: 'Mock execution succeeded',
          stderr: '',
          durationMs: 10,
        };
      },
    };

    const mockEvaluatorFactory = (task: TaskNode): IEvaluator => ({
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: true,
        type: 'BUILD',
        summary: `Mock evaluation passed for ${task.id}`,
        errors: [],
      }),
    });

    return new TaskRunner({
      cliAdapter: mockCli,
      evaluatorFactory: mockEvaluatorFactory,
    });
  }
  return undefined;
}

program
  .name('aire')
  .description('AI iOS App Replica Engine')
  .version('0.1.0');

program
  .command('run')
  .description('Run a single development task or full task graph through the auto-fix loop')
  .option('-t, --task <goal>', 'Task description / goal')
  .option('-p, --project <path>', 'Path to target iOS project directory')
  .option('--task-graph <path>', 'Path to task-graph.yaml')
  .option('--resume', 'Resume interrupted DAG execution')
  .option('--retry-task <id>', 'Retry a failed task and its downstream blocked tasks')
  .option('-s, --scheme <scheme>', 'Xcode scheme name', 'MiniApp')
  .option('-m, --max-retries <number>', 'Maximum auto-fix attempts', '3')
  .option('-r, --reference <path>', 'Path to reference design screenshot')
  .option('--focus <description>', 'Specific visual focus areas')
  .option('--container-delta-max <val>', 'Max allowed container color delta', '7.0')
  .option('--spacing-pt-max <val>', 'Max allowed spacing error in pt', '2.0')
  .option('--text-delta-max <val>', 'Max allowed text color delta', '15.0')
  .option('--device <name>', 'Preferred simulator device name', 'iPhone 16 Pro')
  .option('--settle-delay <ms>', 'Delay in milliseconds after launch before screenshot', '1500')
  .action(async (options) => {
    // 1. Validation: Either --task or --task-graph (or --resume) must be given
    if (!options.task && !options.taskGraph && !options.resume) {
      console.error('❌ [AIRE] Error: Either --task or --task-graph (or --resume) must be specified.');
      process.exit(1);
    }

    if (options.retryTask && !options.resume) {
      console.error('❌ [AIRE] Error: --retry-task requires --resume.');
      process.exit(1);
    }

    // 2. DAG Execution Mode
    if (options.taskGraph || options.resume) {
      const taskGraphPath = options.taskGraph ? resolve(process.cwd(), options.taskGraph) : undefined;
      const projectPath = options.project
        ? resolve(process.cwd(), options.project)
        : (taskGraphPath ? dirname(taskGraphPath) : process.cwd());

      const taskRunner = createCliTaskRunner();

      try {
        let report: DagExecutionReport;

        if (options.resume) {
          console.log(`\n🔄 [AIRE] Resuming DAG execution...`);
          console.log(`📁 Project: ${projectPath}`);
          if (taskGraphPath) console.log(`📋 Task Graph: ${taskGraphPath}`);
          if (options.retryTask) console.log(`🔁 Retry Task: ${options.retryTask}`);
          console.log();

          const scheduler = new SerialDagScheduler({
            ...(taskGraphPath ? { graphPath: taskGraphPath } : {}),
            ...(taskRunner ? { taskRunner } : {}),
          });
          report = await scheduler.resume(projectPath, {
            projectPath,
            maxConcurrency: 1,
            retryTaskId: options.retryTask,
          });
        } else {
          if (!taskGraphPath) {
            console.error('❌ [AIRE] Error: --task-graph <path> is required when not resuming.');
            process.exit(1);
          }

          console.log(`\n🚀 [AIRE] Initializing DAG execution from: ${taskGraphPath}`);
          console.log(`📁 Project: ${projectPath}`);
          console.log();

          const yamlContent = await fs.readFile(taskGraphPath, 'utf-8');
          const graph = TaskGraph.fromYaml(yamlContent);
          if (taskRunner?.setDefaultScheme) {
            taskRunner.setDefaultScheme(graph.project?.targetScheme ?? options.scheme);
          }
          const scheduler = new SerialDagScheduler({
            rawYamlContent: yamlContent,
            graphPath: taskGraphPath,
            ...(taskRunner ? { taskRunner } : {}),
          });
          report = await scheduler.run(graph, {
            projectPath,
            maxConcurrency: 1,
          });
        }

        if (report.status === 'SUCCEEDED') {
          console.log(`\n✅ [AIRE] DAG execution SUCCEEDED!`);
          console.log(`⏱️  Duration: ${report.durationMs}ms`);
          console.log(`🎉 Completed tasks (${report.completedTasks.length}): ${report.completedTasks.join(', ')}`);
          process.exit(0);
        } else {
          console.error(`\n❌ [AIRE] DAG execution ${report.status}!`);
          console.error(`⏱️  Duration: ${report.durationMs}ms`);
          if (report.failedTasks.length > 0) {
            console.error(`💥 Failed tasks (${report.failedTasks.length}): ${report.failedTasks.join(', ')}`);
          }
          if (report.blockedTasks.length > 0) {
            console.error(`🚫 Blocked tasks (${report.blockedTasks.length}): ${report.blockedTasks.join(', ')}`);
          }
          process.exit(1);
        }
      } catch (err: any) {
        console.error(`\n❌ [AIRE] DAG execution error: ${err.message}`);
        process.exit(1);
      }
    }

    // 3. Single-Task Mode (Preserves Sub-project 1 & 2 backward compatibility)
    if (!options.project) {
      console.error('❌ [AIRE] Error: Option -p, --project is required when using -t, --task.');
      process.exit(1);
    }

    const projectPath = resolve(process.cwd(), options.project);
    const maxRetries = parseInt(options.maxRetries ?? '3', 10);
    const referenceImagePath = options.reference ? resolve(process.cwd(), options.reference) : undefined;

    console.log(`\n🚀 [AIRE] Initializing task: "${options.task}"`);
    console.log(`📁 Project: ${projectPath}`);
    console.log(`⚙️  Scheme: ${options.scheme} | Max Retries: ${maxRetries}`);
    if (referenceImagePath) {
      console.log(`🎨 Reference: ${referenceImagePath}`);
      if (options.focus) console.log(`🔍 Focus: ${options.focus}`);
      console.log(`📱 Device: ${options.device}`);
    }
    console.log();

    const visualConfig = referenceImagePath
      ? {
          referenceImagePath,
          focusAreas: options.focus,
          toleranceMatrix: {
            containerDeltaMax: parseFloat(options.containerDeltaMax ?? '7.0'),
            spacingPtMax: parseFloat(options.spacingPtMax ?? '2.0'),
            textDeltaMax: parseFloat(options.textDeltaMax ?? '15.0'),
          },
          preferredDevice: options.device,
          settleDelayMs: parseInt(options.settleDelay ?? '1500', 10),
        }
      : undefined;

    const context = createTaskContext({
      taskId: `TASK-${Date.now()}`,
      projectPath,
      scheme: options.scheme,
      taskGoal: options.task,
      maxRetries,
      visualConfig,
    });

    const isMock = process.env.AIRE_MOCK_RUNNER === '1' || process.env.AIRE_MOCK_RUNNER === 'true';
    const cliAdapter: ICliAdapter = isMock
      ? {
          name: 'MockCliAdapter',
          async isAvailable() { return true; },
          async execute() { return { exitCode: 0, stdout: '', stderr: '', durationMs: 0 }; },
        }
      : new OpenCodeCliAdapter();

    const buildEvaluator: IEvaluator = isMock
      ? {
          name: 'MockBuildEvaluator',
          async evaluate() { return { passed: true, type: 'BUILD' as const, summary: 'Mock build passed', errors: [] }; },
        }
      : new XcodeBuildEvaluator();

    const visualEvaluator: IEvaluator = isMock
      ? {
          name: 'MockVisualEvaluator',
          async evaluate() { return { passed: true, type: 'VISUAL_REVIEW' as const, summary: 'Mock visual passed', errors: [] }; },
        }
      : new VisualReviewEvaluator();

    const pipeline = new EvaluatorPipeline(
      options.reference ? [buildEvaluator, visualEvaluator] : [buildEvaluator]
    );
    const machine = new StateMachine({ cliAdapter, evaluator: pipeline });

    const finalContext = await machine.run(context);

    if (finalContext.state === 'COMPLETED') {
      console.log(`\n✅ [AIRE] Task COMPLETED successfully!`);
      console.log(`🎉 Total iterations: ${finalContext.history.length}`);
      process.exit(0);
    } else {
      console.error(`\n❌ [AIRE] Task FAILED after ${finalContext.currentRetry} retries.`);
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Analyze inputs and generate a validated task-graph.yaml using upstream Multi-Agent Planner')
  .option('-p, --project <path>', 'Path to target iOS project directory')
  .option('-n, --app-name <name>', 'Application name', 'App')
  .option('-s, --scheme <scheme>', 'Target Xcode scheme name')
  .option('-r, --reference <path>', 'Path to reference screenshot file or directory')
  .option('--prd <path>', 'Path to product requirements document (PRD) markdown file')
  .option('-o, --output <path>', 'Output path for task-graph.yaml')
  .option('--auto-run', 'Automatically execute the generated task graph after planning')
  .action(async (options) => {
    const projectPath = options.project ? resolve(process.cwd(), options.project) : process.cwd();
    const appName = options.appName ?? 'App';
    const targetScheme = options.scheme ?? appName;
    const outputPath = options.output
      ? resolve(process.cwd(), options.output)
      : resolve(projectPath, 'task-graph.yaml');

    console.log('🔮 [AIRE Plan] Starting Upstream Multi-Agent Analysis Pipeline...');
    console.log(`📁 Project: ${projectPath}`);
    console.log(`📱 App: ${appName} (Scheme: ${targetScheme})`);
    if (options.reference) console.log(`🎨 Reference: ${options.reference}`);
    if (options.prd) console.log(`📄 PRD: ${options.prd}`);
    console.log(`📝 Output: ${outputPath}`);

    try {
      const orchestrator = new PlannerOrchestrator();
      const planResult = await orchestrator.plan({
        appName,
        targetScheme,
        projectPath,
        referenceFile: options.reference && options.reference.endsWith('.png') ? resolve(process.cwd(), options.reference) : undefined,
        referenceDir: options.reference && !options.reference.endsWith('.png') ? resolve(process.cwd(), options.reference) : undefined,
        prdFile: options.prd ? resolve(process.cwd(), options.prd) : undefined,
        outputPath,
        exportMarkdown: true,
      });

      console.log('\n✅ [AIRE Plan] Upstream Planning Succeeded!');
      console.log(`📄 Machine Truth: ${planResult.irPath}`);
      console.log(`📑 Human Specs: ${planResult.specPaths.join(', ')}`);
      console.log(`🗺️ Task Graph: ${planResult.outputPath} (${planResult.config.tasks.length} tasks)`);

      for (const task of planResult.config.tasks) {
        const deps = task.dependencies.length > 0 ? ` (depends on: ${task.dependencies.join(', ')})` : ' (root)';
        console.log(`  - [${task.id}] ${task.title}${deps}`);
      }

      if (options.autoRun) {
        console.log('\n🚀 [AIRE Plan] --auto-run enabled. Handing off to SerialDagScheduler...');

        // If running in a git repo, commit the generated plan and spec files cleanly so the workspace has a clean base snapshot
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          const { stdout: gitStatus } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectPath });
          if (gitStatus.trim().length > 0) {
            await execFileAsync('git', ['add', '-A'], { cwd: projectPath });
            await execFileAsync('git', ['commit', '-m', 'chore(plan): save generated task graph and specifications'], { cwd: projectPath });
          }
        } catch {
          // Graceful fallback if git is uninitialized
        }

        const taskRunner = createCliTaskRunner();
        const taskGraph = TaskGraph.fromYaml(planResult.yamlContent);
        const scheduler = new SerialDagScheduler({
          taskRunner,
          graphPath: planResult.outputPath,
          rawYamlContent: planResult.yamlContent,
        });
        const report = await scheduler.run(taskGraph, { projectPath });
        if (report.status === 'SUCCEEDED') {
          console.log('\n🎉 [AIRE Plan] Auto-run completed successfully!');
          process.exit(0);
        } else {
          console.error(`\n❌ [AIRE Plan] Auto-run ended with status: ${report.status}`);
          process.exit(1);
        }
      } else {
        console.log('\n💡 Next step: Run the generated plan with:');
        console.log(`   aire run --task-graph ${planResult.outputPath}`);
        process.exit(0);
      }
    } catch (err: any) {
      console.error(`\n❌ [AIRE Plan] Planning failed: ${err.message}`);
      if (err.diagnostics) {
        console.error('Validation diagnostics:');
        for (const diag of err.diagnostics) {
          console.error(`  - [${diag.severity.toUpperCase()}] ${diag.rule}: ${diag.message}`);
        }
      }
      process.exit(1);
    }
  });

program.parse(process.argv);

