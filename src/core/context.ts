import type {
  TaskContext,
  TaskHistoryItem,
  VisualReplicaConfig,
  VisualToleranceMatrix,
} from './types.ts';

export type { VisualToleranceMatrix, VisualReplicaConfig, TaskContext };

export interface CreateTaskOptions {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries?: number;
  visualConfig?: VisualReplicaConfig;
}

export function createTaskContext(params: CreateTaskOptions): TaskContext {
  return {
    taskId: params.taskId,
    projectPath: params.projectPath,
    scheme: params.scheme,
    taskGoal: params.taskGoal,
    maxRetries: params.maxRetries ?? 3,
    currentRetry: 0,
    state: 'IDLE',
    visualConfig: params.visualConfig,
    history: [],
  };
}

export function recordIteration(
  context: TaskContext,
  entry: Omit<TaskHistoryItem, 'iteration' | 'timestamp'>
): void {
  const iteration = context.history.length + 1;
  context.history.push({
    ...entry,
    iteration,
    timestamp: Date.now()
  });
}
