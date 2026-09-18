/**
 * AIRE Serial DAG Scheduler Implementation
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Sections 2.2.1, 4.3, 4.4
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { TaskGraph } from './task-graph.ts';
import type { IScheduler } from './scheduler.interface.ts';
import { SerialWorkspaceStrategy } from './serial-workspace-strategy.ts';
import type { IWorkspaceStrategy } from './workspace-strategy.interface.ts';
import { CascadeExecutionPolicy } from './cascade-execution-policy.ts';
import type { IExecutionPolicy } from './execution-policy.interface.ts';
import { ArtifactManager } from './artifact-manager.ts';
import type { IArtifactManager } from './artifact-manager.interface.ts';
import { RunStateStore, GraphDriftError } from './run-state-store.ts';
import type { IRunStateStore } from './run-state-store.interface.ts';
import { TaskRunner } from './task-runner.ts';
import type { ITaskRunner } from './task-runner.interface.ts';
import {
  FailureDecision,
  type SchedulerOptions,
  type DagExecutionReport,
  type DagRunState,
  type TaskRunRecord,
  type TaskResult,
  type TaskError,
  type TaskExecutionStatus,
  type TaskExecutionOutcome,
  type WorkspaceContext,
  type CommitMetadata,
} from './types.ts';

export class WorkspaceInconsistentError extends Error {
  constructor(message?: string) {
    super(message ?? 'Workspace is inconsistent with task run state');
    this.name = 'WorkspaceInconsistentError';
  }
}

export { GraphDriftError };

export interface SerialDagSchedulerOptions {
  workspaceStrategy?: IWorkspaceStrategy;
  executionPolicy?: IExecutionPolicy;
  artifactManager?: IArtifactManager;
  runStateStore?: IRunStateStore;
  taskRunner?: ITaskRunner;
  rawYamlContent?: string;
  graphPath?: string;
}

export class SerialDagScheduler implements IScheduler {
  private workspaceStrategy: IWorkspaceStrategy;
  private executionPolicy: IExecutionPolicy;
  private artifactManager: IArtifactManager;
  private runStateStore: IRunStateStore;
  private taskRunner: ITaskRunner;
  private rawYamlContent?: string;
  private graphPath?: string;

  constructor(options?: SerialDagSchedulerOptions) {
    this.workspaceStrategy = options?.workspaceStrategy ?? new SerialWorkspaceStrategy();
    this.executionPolicy = options?.executionPolicy ?? new CascadeExecutionPolicy();
    this.artifactManager = options?.artifactManager ?? new ArtifactManager();
    this.runStateStore = options?.runStateStore ?? new RunStateStore();
    this.taskRunner = options?.taskRunner ?? new TaskRunner();
    this.rawYamlContent = options?.rawYamlContent;
    this.graphPath = options?.graphPath;
  }

  /**
   * Run a new DAG execution from the beginning.
   */
  async run(graph: TaskGraph, options: SchedulerOptions): Promise<DagExecutionReport> {
    const startTime = Date.now();
    const projectPath = options.projectPath;
    const runId = randomUUID();

    const graphPath = this.graphPath ?? path.join(projectPath, 'task-graph.yaml');
    let graphHash: string;
    if (this.rawYamlContent) {
      graphHash = this.runStateStore.computeGraphHash(this.rawYamlContent);
    } else {
      const resolvedGraphPath = path.isAbsolute(graphPath)
        ? graphPath
        : path.resolve(projectPath, graphPath);
      try {
        const diskContent = await fs.readFile(resolvedGraphPath, 'utf-8');
        graphHash = this.runStateStore.computeGraphHash(diskContent);
      } catch {
        graphHash = this.runStateStore.computeGraphHash(YAML.stringify(graph.config));
      }
    }

    const tasks: Record<string, TaskRunRecord> = {};
    for (const task of graph.getAllTasks()) {
      tasks[task.id] = {
        taskId: task.id,
        status: 'PENDING',
        retryCount: 0,
      };
    }

    const runState: DagRunState = {
      schemaVersion: '1.0.0',
      graphVersion: graph.version || '1.0.0',
      graphHash,
      runId,
      graphPath,
      status: 'RUNNING',
      activeTaskIds: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks,
    };

    await this.runStateStore.saveRunState(projectPath, runState);

    return this.executeSchedulingLoop(graph, runState, projectPath, options, startTime);
  }

  /**
   * Resume an existing DAG execution using the 4-step calibration protocol.
   */
  async resume(projectPath: string, options?: SchedulerOptions): Promise<DagExecutionReport> {
    const startTime = Date.now();

    // Step 1: Schema migration & Drift validation
    const runState = await this.runStateStore.loadRunState(projectPath);
    if (!runState) {
      throw new Error(`No existing run state found for project: ${projectPath}`);
    }

    let yamlContent = this.rawYamlContent;
    if (!yamlContent) {
      const targetGraphPath = this.graphPath ?? runState.graphPath;
      if (targetGraphPath) {
        const resolvedPath = path.isAbsolute(targetGraphPath)
          ? targetGraphPath
          : path.resolve(projectPath, targetGraphPath);
        try {
          yamlContent = await fs.readFile(resolvedPath, 'utf-8');
        } catch {
          // File might not exist
        }
      }
    }

    if (!yamlContent) {
      throw new Error('Cannot resume: no task graph definition or YAML content available');
    }

    const computedHash = this.runStateStore.computeGraphHash(yamlContent);
    if (runState.graphHash !== computedHash) {
      throw new GraphDriftError(runState.graphHash, computedHash);
    }
    const graph = TaskGraph.fromYaml(yamlContent);

    // Step 2: Crash Calibration for activeTaskIds and non-terminal states
    const activeIds = new Set<string>(runState.activeTaskIds || []);
    for (const [taskId, record] of Object.entries(runState.tasks)) {
      if (['RUNNING', 'VERIFYING', 'REPAIRING', 'RETRYING'].includes(record.status)) {
        activeIds.add(taskId);
      }
    }

    for (const activeTaskId of activeIds) {
      const record = runState.tasks[activeTaskId];
      const taskNode = graph.getTask(activeTaskId);
      if (!record || !taskNode) continue;

      const baseCommit = record.baseCommit;
      const ctx: WorkspaceContext = {
        projectPath,
        taskId: activeTaskId,
        runId: runState.runId,
        allowedFiles: taskNode.allowed_files,
      };

      const head = await this.workspaceStrategy.captureSnapshot(ctx);

      if (baseCommit && head === baseCommit) {
        // Interrupted before commit: rollback dirty files and reset to PENDING
        await this.workspaceStrategy.rollbackWorkspace(ctx, baseCommit);
        record.status = 'PENDING';
        record.error = undefined;
      } else if (baseCommit && head !== baseCommit) {
        // Interrupted after commit: verify commit trailers
        const belongs = await this.workspaceStrategy.verifyCommitBelongsToTask(
          projectPath,
          head,
          activeTaskId,
          runState.runId
        );

        if (belongs) {
          const changedFiles = await this.workspaceStrategy.extractChangedFiles(ctx, baseCommit);
          await this.artifactManager.reconstructTaskResult(
            projectPath,
            taskNode,
            baseCommit,
            head,
            changedFiles
          );
          record.status = 'SUCCEEDED';
          record.commit = head;
          record.completedAt = record.completedAt ?? new Date().toISOString();
          record.resultPath = `.aire/tasks/${activeTaskId}/result.json`;
          record.error = undefined;
        } else {
          throw new WorkspaceInconsistentError(
            `Workspace HEAD commit ${head} does not belong to active task ${activeTaskId} in run ${runState.runId}`
          );
        }
      } else {
        await this.workspaceStrategy.rollbackWorkspace(ctx, head);
        record.status = 'PENDING';
        record.error = undefined;
      }
    }

    runState.activeTaskIds = [];
    runState.updatedAt = new Date().toISOString();
    await this.runStateStore.saveRunState(projectPath, runState);

    // Step 3: Reconcile missing TaskResults for SUCCEEDED tasks
    for (const task of graph.getAllTasks()) {
      const record = runState.tasks[task.id];
      if (record && record.status === 'SUCCEEDED') {
        const existingResult = await this.artifactManager.getTaskResult(projectPath, task.id);
        if (!existingResult) {
          const baseCommit = record.baseCommit ?? '';
          const commit = record.commit ?? baseCommit;
          const ctx: WorkspaceContext = {
            projectPath,
            taskId: task.id,
            runId: runState.runId,
            allowedFiles: task.allowed_files,
          };
          const changedFiles =
            baseCommit && commit && baseCommit !== commit
              ? await this.workspaceStrategy.extractChangedFiles(ctx, baseCommit)
              : [];
          await this.artifactManager.reconstructTaskResult(
            projectPath,
            task,
            baseCommit,
            commit,
            changedFiles
          );
          record.resultPath = `.aire/tasks/${task.id}/result.json`;
        }
      }
    }
    await this.runStateStore.saveRunState(projectPath, runState);

    // Step 4: Retry requested task
    if (options?.retryTaskId) {
      const targetId = options.retryTaskId;
      const record = runState.tasks[targetId];
      if (!record) {
        throw new Error(`Task "${targetId}" not found in task graph`);
      }
      if (record.status !== 'FAILED') {
        throw new Error(
          `Cannot retry task "${targetId}": task is in ${record.status} state, not in FAILED state`
        );
      }

      record.status = 'PENDING';
      record.retryCount = 0;
      record.error = undefined;
      record.completedAt = undefined;
      record.commit = undefined;

      // Reset transitive downstream blocked tasks
      const downstream = graph.getTransitiveDependents(targetId);
      for (const d of downstream) {
        const dRecord = runState.tasks[d.id];
        if (dRecord && dRecord.status === 'BLOCKED') {
          dRecord.status = 'PENDING';
          dRecord.blockedBy = undefined;
          dRecord.error = undefined;
        }
      }

      // Also reset any other tasks explicitly marked blockedBy this targetId
      for (const rec of Object.values(runState.tasks)) {
        if (rec.status === 'BLOCKED' && rec.blockedBy === targetId) {
          rec.status = 'PENDING';
          rec.blockedBy = undefined;
          rec.error = undefined;
        }
      }

      runState.updatedAt = new Date().toISOString();
      await this.runStateStore.saveRunState(projectPath, runState);
    }

    runState.status = 'RUNNING';
    runState.updatedAt = new Date().toISOString();
    await this.runStateStore.saveRunState(projectPath, runState);

    return this.executeSchedulingLoop(graph, runState, projectPath, options, startTime);
  }

  /**
   * Main WAL-style scheduling loop
   */
  private async executeSchedulingLoop(
    graph: TaskGraph,
    runState: DagRunState,
    projectPath: string,
    options: SchedulerOptions | undefined,
    startTime: number
  ): Promise<DagExecutionReport> {
    const taskReports: Record<string, TaskExecutionOutcome> = {};

    while (true) {
      const readyTasks = graph.computeReadyTasks(runState.tasks);

      if (readyTasks.length === 0) {
        const allTasks = graph.getAllTasks();
        const allSucceeded = allTasks.every((t) => runState.tasks[t.id]?.status === 'SUCCEEDED');

        if (allSucceeded) {
          runState.status = 'SUCCEEDED';
        } else {
          runState.status = 'HALTED';
        }

        runState.activeTaskIds = [];
        runState.updatedAt = new Date().toISOString();
        await this.runStateStore.saveRunState(projectPath, runState);
        break;
      }

      // In serial scheduler (concurrency = 1), execute next ready node
      const task = readyTasks[0];
      const taskId = task.id;
      const taskRecord = runState.tasks[taskId];
      const ctx: WorkspaceContext = {
        projectPath,
        taskId,
        runId: runState.runId,
        allowedFiles: task.allowed_files,
      };

      await this.workspaceStrategy.prepareWorkspace(ctx);
      const baseCommit = await this.workspaceStrategy.captureSnapshot(ctx);

      // Persist RUNNING state
      taskRecord.status = 'RUNNING';
      taskRecord.baseCommit = baseCommit;
      taskRecord.startedAt = taskRecord.startedAt ?? new Date().toISOString();
      runState.activeTaskIds = [taskId];
      runState.updatedAt = new Date().toISOString();
      await this.runStateStore.saveRunState(projectPath, runState);

      // Load direct dependency results
      const dependencyResults = await this.artifactManager.getDirectDependencyResults(
        projectPath,
        task.dependencies
      );

      // State change callback hook for real-time WAL persistence
      const onStateChange = async (status: TaskExecutionStatus) => {
        taskRecord.status = status;
        if (status === 'RETRYING') {
          taskRecord.retryCount++;
        }
        runState.updatedAt = new Date().toISOString();
        await this.runStateStore.saveRunState(projectPath, runState);
      };

      const outcome = await this.taskRunner.executeTask(
        task,
        projectPath,
        runState.runId,
        dependencyResults,
        baseCommit,
        onStateChange
      );

      taskReports[taskId] = outcome;

      if (outcome.success) {
        const commitMeta: CommitMetadata = {
          runId: runState.runId,
          taskId,
          baseCommit,
          title: task.title,
        };

        const newCommit = await this.workspaceStrategy.commitTaskWorkspace(ctx, commitMeta);
        const changedFiles = await this.workspaceStrategy.extractChangedFiles(ctx, baseCommit);

        const taskResult: TaskResult = {
          taskId,
          title: task.title,
          goal: task.goal,
          status: 'SUCCEEDED',
          summary: outcome.summary || `Task ${taskId} completed successfully`,
          changedFiles,
          artifacts: [],
          baseCommit,
          commit: newCommit,
          completedAt: new Date().toISOString(),
        };

        await this.artifactManager.saveTaskResult(projectPath, taskResult);

        taskRecord.status = 'SUCCEEDED';
        taskRecord.commit = newCommit;
        taskRecord.completedAt = taskResult.completedAt;
        taskRecord.resultPath = `.aire/tasks/${taskId}/result.json`;
        taskRecord.error = undefined;
        runState.activeTaskIds = [];
        runState.updatedAt = new Date().toISOString();
        await this.runStateStore.saveRunState(projectPath, runState);

        await this.workspaceStrategy.cleanupWorkspace(ctx);
      } else {
        await this.workspaceStrategy.rollbackWorkspace(ctx, baseCommit);

        const error: TaskError = outcome.error ?? {
          type: 'TASK_FAILED',
          message: outcome.summary || `Task ${taskId} failed`,
        };

        const decision = this.executionPolicy.onTaskFailure(task, error, graph);

        taskRecord.status = 'FAILED';
        taskRecord.error = error;
        taskRecord.completedAt = new Date().toISOString();

        if (decision === FailureDecision.CASCADE_BLOCK_AND_CONTINUE) {
          const dependents = graph.getTransitiveDependents(taskId);
          for (const dep of dependents) {
            const depRecord = runState.tasks[dep.id];
            if (depRecord && depRecord.status !== 'SUCCEEDED') {
              depRecord.status = 'BLOCKED';
              depRecord.blockedBy = taskId;
            }
          }
        } else if (decision === FailureDecision.ABORT_ALL) {
          for (const t of graph.getAllTasks()) {
            const rec = runState.tasks[t.id];
            if (rec && (rec.status === 'PENDING' || rec.status === 'READY')) {
              rec.status = 'CANCELLED';
            }
          }
        }

        runState.activeTaskIds = [];
        runState.updatedAt = new Date().toISOString();
        await this.runStateStore.saveRunState(projectPath, runState);

        await this.workspaceStrategy.cleanupWorkspace(ctx);

        if (decision === FailureDecision.ABORT_ALL) {
          runState.status = 'FAILED';
          runState.updatedAt = new Date().toISOString();
          await this.runStateStore.saveRunState(projectPath, runState);
          break;
        }
      }
    }

    const completedTasks: string[] = [];
    const failedTasks: string[] = [];
    const blockedTasks: string[] = [];

    for (const task of graph.getAllTasks()) {
      const rec = runState.tasks[task.id];
      if (!rec) continue;
      if (rec.status === 'SUCCEEDED') {
        completedTasks.push(task.id);
      } else if (rec.status === 'FAILED') {
        failedTasks.push(task.id);
      } else if (rec.status === 'BLOCKED') {
        blockedTasks.push(task.id);
      }

      if (!taskReports[task.id]) {
        if (rec.status === 'SUCCEEDED') {
          taskReports[task.id] = {
            success: true,
            taskId: task.id,
            baseCommit: rec.baseCommit,
            commit: rec.commit,
            summary: `Task ${task.id} succeeded in previous run`,
          };
        } else if (rec.status === 'FAILED') {
          taskReports[task.id] = {
            success: false,
            taskId: task.id,
            baseCommit: rec.baseCommit,
            error: rec.error,
            summary: rec.error?.message ?? `Task ${task.id} failed in previous run`,
          };
        }
      }
    }

    return {
      runId: runState.runId,
      status: runState.status as 'SUCCEEDED' | 'HALTED' | 'FAILED',
      durationMs: Date.now() - startTime,
      completedTasks,
      failedTasks,
      blockedTasks,
      taskReports,
    };
  }
}
