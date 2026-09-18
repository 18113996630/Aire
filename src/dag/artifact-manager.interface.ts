/**
 * AIRE Task Artifact & Contract Manager Interface
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 2.2.4
 */

import type { TaskResult, TaskNode } from './types.ts';

export interface IArtifactManager {
  /**
   * Persist structured task result to .aire/tasks/<taskId>/result.json
   */
  saveTaskResult(projectPath: string, result: TaskResult): Promise<void>;

  /**
   * Retrieve task result for a given taskId, or null if not found
   */
  getTaskResult(projectPath: string, taskId: string): Promise<TaskResult | null>;

  /**
   * Retrieve direct dependency task results, filtering out missing/non-existent results
   */
  getDirectDependencyResults(projectPath: string, dependencyIds: string[]): Promise<TaskResult[]>;

  /**
   * Idempotently reconstruct and persist a TaskResult from Git and TaskNode metadata
   */
  reconstructTaskResult(
    projectPath: string,
    task: TaskNode,
    baseCommit: string,
    commit: string,
    changedFiles: string[]
  ): Promise<TaskResult>;
}
