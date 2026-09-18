import type { ITaskRunner } from './task-runner.interface.ts';
import type { TaskNode, TaskResult, TaskExecutionStatus, TaskExecutionOutcome } from './types.ts';
import { buildDagTaskPrompt } from './prompt-builder-dag.ts';
import {
  createTaskContext,
  type VisualReplicaConfig,
  type TaskContext,
} from '../core/context.ts';
import { StateMachine } from '../core/state-machine.ts';
import type { ICliAdapter } from '../runtime/adapter.interface.ts';
import { OpenCodeCliAdapter } from '../runtime/opencode.adapter.ts';
import type { IEvaluator } from '../evaluator/evaluator.interface.ts';
import { EvaluatorPipeline } from '../evaluator/pipeline.ts';
import { XcodeBuildEvaluator, type ProcessRunner } from '../evaluator/xcodebuild.ts';
import { VisualReviewEvaluator } from '../evaluator/visual/visual-evaluator.ts';

export interface TaskRunnerOptions {
  cliAdapter?: ICliAdapter;
  evaluatorFactory?: (task: TaskNode) => IEvaluator;
  defaultScheme?: string;
  processRunner?: ProcessRunner;
}

export class TaskRunner implements ITaskRunner {
  private options: TaskRunnerOptions;

  constructor(options?: TaskRunnerOptions) {
    this.options = options ?? {};
  }

  /**
   * Set or update default scheme if not explicitly provided during construction
   */
  setDefaultScheme(scheme?: string): void {
    if (scheme && !this.options.defaultScheme) {
      this.options.defaultScheme = scheme;
    }
  }

  /**
   * Constructs the appropriate IEvaluator for the given task.
   * If evaluatorFactory is provided, delegates to it;
   * otherwise, builds EvaluatorPipeline([XcodeBuildEvaluator, VisualReviewEvaluator])
   * if task.verification.visual is configured, or XcodeBuildEvaluator otherwise.
   */
  createEvaluator(task: TaskNode): IEvaluator {
    if (this.options.evaluatorFactory) {
      return this.options.evaluatorFactory(task);
    }

    const buildEvaluator = new XcodeBuildEvaluator(
      this.options.processRunner ? { runner: this.options.processRunner } : undefined
    );

    if (task.verification?.visual) {
      const visualEvaluator = new VisualReviewEvaluator();
      return new EvaluatorPipeline([buildEvaluator, visualEvaluator]);
    }

    return buildEvaluator;
  }

  /**
   * Maps task.verification.visual to VisualReplicaConfig if present.
   */
  createVisualConfig(task: TaskNode): VisualReplicaConfig | undefined {
    if (!task.verification?.visual) {
      return undefined;
    }

    const visual = task.verification.visual;
    return {
      referenceImagePath: visual.reference,
      focusAreas: visual.focus,
      toleranceMatrix: {
        containerDeltaMax: visual.tolerance?.containerDeltaMax ?? 7.0,
        spacingPtMax: visual.tolerance?.spacingPtMax ?? 2.0,
        textDeltaMax: visual.tolerance?.textDeltaMax ?? 15.0,
      },
      ...({ focus: visual.focus } as any),
    };
  }

  /**
   * Executes a DAG TaskNode by adapting it to the atomic StateMachine.
   */
  async executeTask(
    task: TaskNode,
    projectPath: string,
    runId: string,
    dependencyResults: TaskResult[],
    baseCommit: string,
    onStateChange: (status: TaskExecutionStatus) => Promise<void>
  ): Promise<TaskExecutionOutcome> {
    // 1. Determine scheme
    let scheme = this.options.defaultScheme ?? 'App';
    if (
      task.verification?.build &&
      typeof task.verification.build === 'object' &&
      task.verification.build.scheme
    ) {
      scheme = task.verification.build.scheme;
    }

    // 2. Map visual config
    const visualConfig = this.createVisualConfig(task);

    // 3. Build markdown prompt including direct dependencies
    const prompt = buildDagTaskPrompt(task, dependencyResults);

    // 4. Create atomic TaskContext
    const context = createTaskContext({
      taskId: task.id,
      projectPath,
      scheme,
      taskGoal: prompt,
      maxRetries: task.max_retries ?? 3,
      visualConfig,
    });

    // 5. Wrap CLI adapter to hook onStateChange for initial coding (RUNNING)
    const cli = this.options.cliAdapter ?? new OpenCodeCliAdapter();
    let isFirstCliCall = true;
    const wrappedCli: ICliAdapter = {
      name: cli.name,
      isAvailable: () => cli.isAvailable(),
      execute: async (params) => {
        if (isFirstCliCall) {
          isFirstCliCall = false;
          await onStateChange('RUNNING');
        }
        return cli.execute(params);
      },
    };

    // 6. Wrap Evaluator to hook onStateChange for VERIFYING, REPAIRING, RETRYING
    const baseEvaluator = this.createEvaluator(task);
    const wrappedEvaluator: IEvaluator = {
      name: baseEvaluator.name,
      evaluate: async (ctx: TaskContext) => {
        await onStateChange('VERIFYING');
        const result = await baseEvaluator.evaluate(ctx);

        // If evaluation failed and StateMachine will attempt another retry
        if (!result.passed && ctx.currentRetry + 1 < ctx.maxRetries) {
          await onStateChange('REPAIRING');
          await onStateChange('RETRYING');
        }

        return result;
      },
    };

    // 7. Execute StateMachine with skipGit: true (DAG Scheduler handles workspace commits/rollbacks)
    const machine = new StateMachine({
      cliAdapter: wrappedCli,
      evaluator: wrappedEvaluator,
      skipGit: true,
    });

    try {
      const finalCtx = await machine.run(context);

      if (finalCtx.state === 'COMPLETED') {
        const lastSummary = finalCtx.history.at(-1)?.evaluationResult?.summary;
        return {
          success: true,
          taskId: task.id,
          baseCommit,
          changedFiles: [],
          summary: lastSummary || 'Task completed successfully',
        };
      } else {
        const lastSummary = finalCtx.history.at(-1)?.evaluationResult?.summary;
        return {
          success: false,
          taskId: task.id,
          baseCommit,
          changedFiles: [],
          error: {
            type: 'VERIFICATION_FAILED',
            message: lastSummary || 'Verification failed',
          },
          summary: 'Task failed after retries',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        taskId: task.id,
        baseCommit,
        changedFiles: [],
        error: {
          type: 'TASK_EXECUTION_ERROR',
          message: err?.message || String(err),
          details: err,
        },
        summary: err?.message || 'Task failed due to execution error',
      };
    }
  }
}
