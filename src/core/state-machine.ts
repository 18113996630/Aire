import type { TaskContext } from './types.ts';
import { recordIteration } from './context.ts';
import type { ICliAdapter } from '../runtime/adapter.interface.ts';
import type { IEvaluator } from '../evaluator/evaluator.interface.ts';
import { GitManager, DirtyWorkspaceError } from '../vcs/git-manager.ts';
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
        await git.assertClean();
        activeCtx.initialCommitSha = await git.getHeadSha();
      } catch (err: any) {
        if (err instanceof DirtyWorkspaceError) {
          activeCtx.state = 'FAILED';
          throw err;
        }
        git = null;
      }
    }

    let currentPrompt = activeCtx.taskGoal;
    let isFix = false;

    try {
      while (true) {
        // 1. Agent Coding
        activeCtx.state = isFix ? 'FIXING' : 'AGENT_CODING';
        const cliResult = await this.cli.execute({
          cwd: activeCtx.projectPath,
          prompt: currentPrompt
        });

        // 1.1 Check CLI Exit Code
        if (cliResult.exitCode !== 0) {
          const cliErr = cliResult.stderr.trim() || cliResult.stdout.trim() || `Process exited with code ${cliResult.exitCode}`;
          const cliEvalResult = {
            passed: false,
            type: 'BUILD' as const,
            summary: `CLI coding failed (exit code ${cliResult.exitCode}): ${cliErr.slice(0, 200)}`,
            errors: []
          };
          activeCtx.state = 'EVALUATING';
          recordIteration(activeCtx, {
            action: isFix ? 'FIX_PROMPT' : 'INITIAL_PROMPT',
            promptUsed: currentPrompt,
            cliSummary: `[Exit ${cliResult.exitCode}] ${cliErr.slice(0, 200)}`,
            evaluationResult: cliEvalResult
          });

          activeCtx.currentRetry++;
          if (activeCtx.currentRetry >= activeCtx.maxRetries) {
            activeCtx.state = 'ROLLING_BACK';
            if (git && activeCtx.initialCommitSha) {
              try {
                await git.hardReset(activeCtx.initialCommitSha);
              } catch {
                // Ignore rollback error
              }
            }
            activeCtx.state = 'FAILED';
            return activeCtx;
          }

          currentPrompt = `CLI execution failed with exit code ${cliResult.exitCode}.\nErrors:\n${cliErr}\nPlease fix the issue and fulfill the task:\n${activeCtx.taskGoal}`;
          isFix = true;
          continue;
        }

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
            } catch (commitErr: any) {
              activeCtx.state = 'ROLLING_BACK';
              if (activeCtx.initialCommitSha) {
                try {
                  await git.hardReset(activeCtx.initialCommitSha);
                } catch {
                  // Ignore rollback error
                }
              }
              activeCtx.state = 'FAILED';
              throw new Error(`Failed to commit atomic task changes: ${commitErr?.message || String(commitErr)}`);
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
    } catch (err: any) {
      if (activeCtx.state !== 'FAILED') {
        activeCtx.state = 'ROLLING_BACK';
        if (git && activeCtx.initialCommitSha) {
          try {
            await git.hardReset(activeCtx.initialCommitSha);
          } catch {
            // Ignore rollback failure
          }
        }
        activeCtx.state = 'FAILED';
      }
      throw err;
    }
  }
}
