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
  private defaultContext?: TaskContext;

  constructor(options: StateMachineOptions);
  constructor(context: TaskContext, cliAdapter: ICliAdapter, evaluator: IEvaluator);
  constructor(
    optionsOrContext: StateMachineOptions | TaskContext,
    cliAdapter?: ICliAdapter,
    evaluator?: IEvaluator
  ) {
    if ('cliAdapter' in optionsOrContext && 'evaluator' in optionsOrContext) {
      this.cli = optionsOrContext.cliAdapter;
      this.evaluator = optionsOrContext.evaluator;
      this.skipGit = optionsOrContext.skipGit ?? false;
    } else {
      this.defaultContext = optionsOrContext as TaskContext;
      this.cli = cliAdapter!;
      this.evaluator = evaluator!;
      this.skipGit = false;
    }
  }

  async run(ctx?: TaskContext): Promise<TaskContext> {
    const activeCtx = ctx ?? this.defaultContext;
    if (!activeCtx) {
      throw new Error('TaskContext must be provided to StateMachine constructor or run()');
    }

    activeCtx.state = 'INITIALIZING';
    let git: GitManager | null = null;

    if (!this.skipGit) {
      try {
        git = new GitManager(activeCtx.projectPath);
        activeCtx.initialCommitSha = await git.getHeadSha();
      } catch {
        git = null;
      }
    }

    let currentPrompt = activeCtx.taskGoal;
    let isFix = false;

    while (true) {
      // 1. Agent Coding
      activeCtx.state = isFix ? 'FIXING' : 'AGENT_CODING';
      const cliResult = await this.cli.execute({
        cwd: activeCtx.projectPath,
        prompt: currentPrompt
      });

      // 2. Building & Evaluating
      activeCtx.state = 'BUILDING';
      const evalResult = await this.evaluator.evaluate(activeCtx);
      activeCtx.state = 'EVALUATING';

      recordIteration(activeCtx, {
        action: isFix ? 'FIX_PROMPT' : 'INITIAL_PROMPT',
        promptUsed: currentPrompt,
        cliSummary: cliResult.stdout.slice(0, 200),
        evaluationResult: evalResult
      });

      // 3. Evaluation Check
      if (evalResult.passed) {
        activeCtx.state = 'COMMITTING';
        if (git) {
          try {
            await git.commitChanges(`feat(aire): ${activeCtx.taskGoal}`);
          } catch {
            // Ignore if commit fails in non-git or clean environment
          }
        }
        activeCtx.state = 'COMPLETED';
        return activeCtx;
      }

      // 4. Failure Handling & Fix Loop
      activeCtx.currentRetry++;
      if (activeCtx.currentRetry >= activeCtx.maxRetries) {
        activeCtx.state = 'ROLLING_BACK';
        if (git && activeCtx.initialCommitSha) {
          try {
            await git.hardReset(activeCtx.initialCommitSha);
          } catch {
            // Ignore rollback failure if git unavailable
          }
        }
        activeCtx.state = 'FAILED';
        return activeCtx;
      }

      // 组装下一次修复的 Prompt
      currentPrompt = buildFixPrompt(activeCtx, evalResult);
      isFix = true;
    }
  }
}
