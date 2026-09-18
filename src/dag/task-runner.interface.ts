import type { TaskNode, TaskResult, TaskExecutionStatus, TaskExecutionOutcome } from './types.ts';

/**
 * TaskRunner Adapter Interface
 * Consumes TaskNode + predecessor TaskResults, executes single-task loop via existing atomic StateMachine,
 * and returns TaskExecutionOutcome while emitting lifecycle status changes.
 */
export interface ITaskRunner {
  executeTask(
    task: TaskNode,
    projectPath: string,
    runId: string,
    dependencyResults: TaskResult[],
    baseCommit: string,
    onStateChange: (status: TaskExecutionStatus) => Promise<void>
  ): Promise<TaskExecutionOutcome>;

  setDefaultScheme?(scheme?: string): void;
}
