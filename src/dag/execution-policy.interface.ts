import type { TaskNode, TaskError, FailureDecision } from './types.ts';
import type { TaskGraph } from './task-graph.ts';

export interface IExecutionPolicy {
  onTaskFailure(task: TaskNode, error: TaskError, graph: TaskGraph): FailureDecision;
}
