/**
 * AIRE DAG Scheduler Interface
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 2.2.1
 */

import type { TaskGraph } from './task-graph.ts';
import type { SchedulerOptions, DagExecutionReport } from './types.ts';

export interface IScheduler {
  run(graph: TaskGraph, options: SchedulerOptions): Promise<DagExecutionReport>;
  resume(projectPath: string, options?: SchedulerOptions): Promise<DagExecutionReport>;
}
