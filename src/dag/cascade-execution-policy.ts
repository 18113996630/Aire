import type { IExecutionPolicy } from './execution-policy.interface.ts';
import { FailureDecision, type TaskError, type TaskNode } from './types.ts';
import type { TaskGraph } from './task-graph.ts';

/**
 * CascadeExecutionPolicy
 *
 * Implements IExecutionPolicy with pure fault-tolerance decision logic.
 * Returns FailureDecision.CASCADE_BLOCK_AND_CONTINUE on task failure.
 *
 * Strict architectural requirement:
 * Pure decision logic only. Does not mutate task, error, or task-graph state.
 * Downstream blocked sets are calculated by TaskGraph.getTransitiveDependents,
 * and state transitions are handled exclusively by the Scheduler.
 */
export class CascadeExecutionPolicy implements IExecutionPolicy {
  onTaskFailure(_task: TaskNode, _error: TaskError, _graph: TaskGraph): FailureDecision {
    return FailureDecision.CASCADE_BLOCK_AND_CONTINUE;
  }
}
