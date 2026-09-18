/**
 * AIRE Task Artifact & Contract Manager Implementation
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Sections 2.2.4 & 3.3
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskResult, TaskNode } from './types.ts';
import type { IArtifactManager } from './artifact-manager.interface.ts';

/**
 * Extract public/internal Swift type and protocol declarations from changed .swift files.
 */
export async function extractSwiftApiContracts(
  projectPath: string,
  changedFiles: string[]
): Promise<string[]> {
  const contracts: string[] = [];
  const swiftFiles = changedFiles.filter((f) => f.endsWith('.swift'));

  for (const relFile of swiftFiles) {
    const fullPath = path.isAbsolute(relFile) ? relFile : path.join(projectPath, relFile);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(
          /^(?:(?:public|open|internal|final|fileprivate|private)\s+)*(?:struct|class|enum|protocol|actor|typealias)\s+([A-Za-z0-9_]+(?:\s*:[^{=]+)?(?:\s*=[^{]+)?)/
        );
        if (match) {
          const decl = match[0].replace(/\s*\{.*$/, '').trim();
          if (decl && !contracts.includes(decl)) {
            contracts.push(decl);
          }
        }
      }
    } catch {
      // File might have been deleted or inaccessible
    }
  }

  return contracts;
}

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
   * Retrieve task result for a given taskId, or null if not found (ENOENT).
   * Throws error if JSON is corrupted or disk read fails.
   */
  async getTaskResult(projectPath: string, taskId: string): Promise<TaskResult | null> {
    const filePath = this.getTaskResultPath(projectPath, taskId);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    try {
      return JSON.parse(content) as TaskResult;
    } catch (parseError: any) {
      throw new Error(`Corrupted task result at ${filePath}: ${parseError.message}`);
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

    const apiContracts =
      isExistingValidForCommit && existing.apiContracts && existing.apiContracts.length > 0
        ? existing.apiContracts
        : await extractSwiftApiContracts(projectPath, changedFiles);

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
      apiContracts,
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
