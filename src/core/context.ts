import type { TaskContext, TaskHistoryItem } from './types.ts';

export interface CreateTaskOptions {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries?: number;
}

export function createTaskContext(options: CreateTaskOptions): TaskContext {
  return {
    taskId: options.taskId,
    projectPath: options.projectPath,
    scheme: options.scheme,
    taskGoal: options.taskGoal,
    maxRetries: options.maxRetries ?? 3,
    currentRetry: 0,
    state: 'IDLE',
    history: []
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
