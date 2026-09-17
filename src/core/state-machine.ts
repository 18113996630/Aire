import type { TaskContext } from './types.ts';
import { recordIteration } from './context.ts';
import type { ICliAdapter } from '../runtime/adapter.interface.ts';
import type { IEvaluator } from '../evaluator/evaluator.interface.ts';
import { GitManager } from '../vcs/git-manager.ts';
import { buildFixPrompt } from './prompt-builder.ts';

export interface StateMachineOptions {
  cliAdapter: ICliAdapter;
  evaluator: IEvaluator;
  skipGit?: boolean;
}

export class StateMachine {
  private cli: ICliAdapter;
  private evaluator: IEvaluator;
  private skipGit: boolean;

  constructor(options: StateMachineOptions) {
    this.cli = options.cliAdapter;
    this.evaluator = options.evaluator;
    this.skipGit = options.skipGit ?? false;
  }

  async run(ctx: TaskContext): Promise<TaskContext> {
    ctx.state = 'INITIALIZING';
    let git: GitManager | null = null;

    if (!this.skipGit) {
      git = new GitManager(ctx.projectPath);
      ctx.initialCommitSha = await git.getHeadSha();
    }

    let currentPrompt = ctx.taskGoal;
    let isFix = false;

    while (true) {
      // 1. Agent Coding
      ctx.state = isFix ? 'FIXING' : 'AGENT_CODING';
      const cliResult = await this.cli.execute({
        cwd: ctx.projectPath,
        prompt: currentPrompt
      });

      // 2. Building & Evaluating
      ctx.state = 'BUILDING';
      const evalResult = await this.evaluator.evaluate(ctx);
      ctx.state = 'EVALUATING';

      recordIteration(ctx, {
        action: isFix ? 'FIX_PROMPT' : 'INITIAL_PROMPT',
        promptUsed: currentPrompt,
        cliSummary: cliResult.stdout.slice(0, 200),
        evaluationResult: evalResult
      });

      // 3. Evaluation Check
      if (evalResult.passed) {
        ctx.state = 'COMMITTING';
        if (git) {
          await git.commitChanges(`feat(aire): ${ctx.taskGoal}`);
        }
        ctx.state = 'COMPLETED';
        return ctx;
      }

      // 4. Failure Handling & Fix Loop
      ctx.currentRetry++;
      if (ctx.currentRetry >= ctx.maxRetries) {
        ctx.state = 'ROLLING_BACK';
        if (git && ctx.initialCommitSha) {
          await git.hardReset(ctx.initialCommitSha);
        }
        ctx.state = 'FAILED';
        return ctx;
      }

      // 组装下一次修复的 Prompt
      currentPrompt = buildFixPrompt(evalResult.errors);
      isFix = true;
    }
  }
}
