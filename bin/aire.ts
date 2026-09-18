#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { createTaskContext } from '../src/core/context.ts';
import { StateMachine } from '../src/core/state-machine.ts';
import { OpenCodeCliAdapter } from '../src/runtime/opencode.adapter.ts';
import { XcodeBuildEvaluator } from '../src/evaluator/xcodebuild.ts';
import { EvaluatorPipeline } from '../src/evaluator/pipeline.ts';
import { VisualReviewEvaluator } from '../src/evaluator/visual/visual-evaluator.ts';

const program = new Command();

program
  .name('aire')
  .description('AI iOS App Replica Engine')
  .version('0.1.0');

program
  .command('run')
  .description('Run a single development task through the auto-fix loop')
  .requiredOption('-t, --task <goal>', 'Task description / goal')
  .requiredOption('-p, --project <path>', 'Path to target iOS project directory')
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
    const projectPath = resolve(process.cwd(), options.project);
    const maxRetries = parseInt(options.maxRetries, 10);
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

    const cliAdapter = new OpenCodeCliAdapter();
    const buildEvaluator = new XcodeBuildEvaluator();
    const visualEvaluator = new VisualReviewEvaluator();
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

program.parse(process.argv);
