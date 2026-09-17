#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { createTaskContext } from '../src/core/context.ts';
import { StateMachine } from '../src/core/state-machine.ts';
import { OpenCodeCliAdapter } from '../src/runtime/opencode.adapter.ts';
import { XcodeBuildEvaluator } from '../src/evaluator/xcodebuild.ts';

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
  .option('-r, --max-retries <number>', 'Maximum auto-fix attempts', '3')
  .action(async (options) => {
    const projectPath = resolve(process.cwd(), options.project);
    const maxRetries = parseInt(options.maxRetries, 10);

    console.log(`\n🚀 [AIRE] Initializing task: "${options.task}"`);
    console.log(`📁 Project: ${projectPath}`);
    console.log(`⚙️  Scheme: ${options.scheme} | Max Retries: ${maxRetries}\n`);

    const context = createTaskContext({
      taskId: `TASK-${Date.now()}`,
      projectPath,
      scheme: options.scheme,
      taskGoal: options.task,
      maxRetries
    });

    const cliAdapter = new OpenCodeCliAdapter();
    const evaluator = new XcodeBuildEvaluator();
    const machine = new StateMachine({ cliAdapter, evaluator });

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
