import YAML from 'yaml';
import type {
  TaskNode,
  TaskGraphConfig,
  TaskExecutionStatus
} from './types.ts';

export class DuplicateTaskIdError extends Error {
  public readonly taskId: string;

  constructor(taskId: string) {
    super(`Duplicate task ID detected: "${taskId}"`);
    this.name = 'DuplicateTaskIdError';
    this.taskId = taskId;
  }
}

export class CycleDetectedError extends Error {
  public readonly cyclePath: string[];

  constructor(cyclePath: string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(' -> ')}`);
    this.name = 'CycleDetectedError';
    this.cyclePath = cyclePath;
  }
}

export class TaskGraph {
  public readonly config: TaskGraphConfig;
  private readonly tasksById: Map<string, TaskNode>;
  private readonly taskList: TaskNode[];

  constructor(config: TaskGraphConfig) {
    const rawTasks = config.tasks ?? [];

    // 1. Duplicate task ID validation
    const seenIds = new Set<string>();
    for (const task of rawTasks) {
      if (seenIds.has(task.id)) {
        throw new DuplicateTaskIdError(task.id);
      }
      seenIds.add(task.id);
    }

    // 2. Clone and normalize task nodes
    this.taskList = rawTasks.map(task => ({
      ...task,
      dependencies: task.dependencies ? [...task.dependencies] : [],
      dependents: [],
      allowed_files: task.allowed_files ? [...task.allowed_files] : [],
      acceptance_criteria: task.acceptance_criteria ? [...task.acceptance_criteria] : [],
      verification: task.verification ?? { build: true }
    }));

    this.tasksById = new Map<string, TaskNode>();
    for (const task of this.taskList) {
      this.tasksById.set(task.id, task);
    }

    // 3. Unknown dependency reference validation
    for (const task of this.taskList) {
      for (const depId of task.dependencies) {
        if (!this.tasksById.has(depId)) {
          throw new Error(`Unknown dependency "${depId}" referenced by task "${task.id}"`);
        }
      }
    }

    // 4. Cycle detection via DFS graph coloring (White / Gray / Black)
    this.detectCycles();

    // 5. Build reverse dependencies (dependents)
    for (const task of this.taskList) {
      for (const depId of task.dependencies) {
        const dependencyNode = this.tasksById.get(depId)!;
        if (!dependencyNode.dependents.includes(task.id)) {
          dependencyNode.dependents.push(task.id);
        }
      }
    }

    this.config = {
      ...config,
      tasks: this.taskList
    };
  }

  static fromYaml(yamlContent: string): TaskGraph {
    const parsed = YAML.parse(yamlContent);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid YAML: parsed content must be an object');
    }
    return new TaskGraph(parsed as TaskGraphConfig);
  }

  get version(): string {
    return this.config.version;
  }

  get project(): { name: string; targetScheme: string } {
    return this.config.project;
  }

  getAllTasks(): TaskNode[] {
    return [...this.taskList];
  }

  getTask(id: string): TaskNode | undefined {
    return this.tasksById.get(id);
  }

  getDirectDependencies(id: string): TaskNode[] {
    const task = this.tasksById.get(id);
    if (!task) return [];
    return task.dependencies.map(depId => this.tasksById.get(depId)!).filter(Boolean);
  }

  getDirectDependents(id: string): TaskNode[] {
    const task = this.tasksById.get(id);
    if (!task) return [];
    return task.dependents.map(depId => this.tasksById.get(depId)!).filter(Boolean);
  }

  getTransitiveDependents(id: string): TaskNode[] {
    const result: TaskNode[] = [];
    const visited = new Set<string>();
    const queue: string[] = [id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = this.tasksById.get(currentId);
      if (!current) continue;

      for (const depId of current.dependents) {
        if (!visited.has(depId)) {
          visited.add(depId);
          const node = this.tasksById.get(depId);
          if (node) {
            result.push(node);
            queue.push(depId);
          }
        }
      }
    }

    return result;
  }

  computeReadyTasks(records: Record<string, { status: TaskExecutionStatus }>): TaskNode[] {
    return this.taskList.filter(task => {
      const record = records[task.id];
      if (!record || record.status !== 'PENDING') {
        return false;
      }
      return task.dependencies.every(depId => records[depId]?.status === 'SUCCEEDED');
    });
  }

  private detectCycles(): void {
    const color = new Map<string, 'WHITE' | 'GRAY' | 'BLACK'>();
    for (const task of this.taskList) {
      color.set(task.id, 'WHITE');
    }

    const stack: string[] = [];

    const dfs = (currentId: string) => {
      color.set(currentId, 'GRAY');
      stack.push(currentId);

      const task = this.tasksById.get(currentId)!;
      for (const depId of task.dependencies) {
        const depColor = color.get(depId);
        if (depColor === 'GRAY') {
          const cycleStartIndex = stack.indexOf(depId);
          const cyclePath = [...stack.slice(cycleStartIndex), depId];
          throw new CycleDetectedError(cyclePath);
        }
        if (depColor === 'WHITE') {
          dfs(depId);
        }
      }

      stack.pop();
      color.set(currentId, 'BLACK');
    };

    for (const task of this.taskList) {
      if (color.get(task.id) === 'WHITE') {
        dfs(task.id);
      }
    }
  }
}
