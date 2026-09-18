/**
 * AIRE Task Artifact & Contract Manager Implementation
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Sections 2.2.4 & 3.3
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskResult, TaskNode } from './types.ts';
import type { IArtifactManager } from './artifact-manager.interface.ts';

export class ArtifactManager implements IArtifactManager {
  private getTaskResultPath(projectPath: string, taskId: string): string {
    return path.join(projectPath, '.aire', 'tasks', taskId, 'result.json');
  }

  /**
   * Persist structured task result to .aire/tasks/<taskId>/result.json
   */
  async saveTaskResult(projectPath: string, result: TaskResult): Promise<void> {
    const filePath = this.getTaskResultPath(projectPath, result.taskId);
    const dirPath = path.dirname(filePath);

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  }

  /**
   * Retrieve task result for a given taskId, or null if not found or corrupted
   */
  async getTaskResult(projectPath: string, taskId: string): Promise<TaskResult | null> {
    const filePath = this.getTaskResultPath(projectPath, taskId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as TaskResult;
    } catch {
      return null;
    }
  }

  /**
   * Retrieve direct dependency task results, filtering out missing/non-existent results
   */
  async getDirectDependencyResults(projectPath: string, dependencyIds: string[]): Promise<TaskResult[]> {
    if (!dependencyIds || dependencyIds.length === 0) {
      return [];
    }

    const results = await Promise.all(
      dependencyIds.map((depId) => this.getTaskResult(projectPath, depId))
    );

    return results.filter((res): res is TaskResult => res !== null);
  }

  /**
   * Idempotently reconstruct and persist a TaskResult from Git and TaskNode metadata
   */
  async reconstructTaskResult(
    projectPath: string,
    task: TaskNode,
    baseCommit: string,
    commit: string,
    changedFiles: string[]
  ): Promise<TaskResult> {
    const existing = await this.getTaskResult(projectPath, task.id);
    const isExistingValidForCommit = existing !== null && existing.commit === commit;

    const result: TaskResult = {
      taskId: task.id,
      title: task.title,
      goal: task.goal,
      status: 'SUCCEEDED',
      summary:
        isExistingValidForCommit && existing.summary
          ? existing.summary
          : `Reconstructed task result for ${task.id} (${task.title})`,
      changedFiles,
      artifacts: isExistingValidForCommit && existing.artifacts ? existing.artifacts : [],
      apiContracts: isExistingValidForCommit && existing.apiContracts ? existing.apiContracts : [],
      baseCommit,
      commit,
      completedAt:
        isExistingValidForCommit && existing.completedAt
          ? existing.completedAt
          : new Date().toISOString()
    };

    await this.saveTaskResult(projectPath, result);
    return result;
  }
}
