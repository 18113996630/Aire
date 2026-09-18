import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TaskGraph,
  CycleDetectedError,
  DuplicateTaskIdError
} from '../../../src/dag/task-graph.ts';
import type { TaskExecutionStatus } from '../../../src/dag/types.ts';

const VALID_DIAMOND_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-1"
    title: "Data Models"
    goal: "Define SwiftData schemas"
    role: "Architect"
    dependencies: []
    allowed_files:
      - "Models/Item.swift"
    acceptance_criteria:
      - "Models compile without error"
    verification:
      build: true
  - id: "task-2"
    title: "Item List UI"
    goal: "Create list view"
    role: "iOS Developer"
    dependencies:
      - "task-1"
    allowed_files:
      - "Views/ItemListView.swift"
    acceptance_criteria:
      - "List displays items"
    verification:
      build: true
  - id: "task-3"
    title: "Item Detail UI"
    goal: "Create detail view"
    role: "iOS Developer"
    dependencies:
      - "task-1"
    allowed_files:
      - "Views/ItemDetailView.swift"
    acceptance_criteria:
      - "Detail view shows attributes"
    verification:
      build: true
  - id: "task-4"
    title: "Navigation & Flow"
    goal: "Connect views with Coordinator"
    role: "iOS Developer"
    dependencies:
      - "task-2"
      - "task-3"
    allowed_files:
      - "Navigation/AppCoordinator.swift"
    acceptance_criteria:
      - "User can navigate from list to detail"
    verification:
      build: true
`;

const DUPLICATE_ID_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-model"
    title: "Model A"
    goal: "Goal A"
    role: "iOS Developer"
    dependencies: []
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-model"
    title: "Model B (duplicate)"
    goal: "Goal B"
    role: "iOS Developer"
    dependencies: []
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
`;

const CYCLE_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-a"
    title: "Task A"
    goal: "Goal A"
    role: "iOS Developer"
    dependencies:
      - "task-b"
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-b"
    title: "Task B"
    goal: "Goal B"
    role: "iOS Developer"
    dependencies:
      - "task-c"
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-c"
    title: "Task C"
    goal: "Goal C"
    role: "iOS Developer"
    dependencies:
      - "task-a"
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
`;

const SELF_CYCLE_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-self"
    title: "Self loop task"
    goal: "Goal Self"
    role: "iOS Developer"
    dependencies:
      - "task-self"
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
`;

const UNKNOWN_DEP_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-a"
    title: "Task A"
    goal: "Goal A"
    role: "iOS Developer"
    dependencies:
      - "task-non-existent"
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
`;

test('TaskGraph parses valid YAML and constructs forward/reverse dependencies', () => {
  const graph = TaskGraph.fromYaml(VALID_DIAMOND_YAML);

  assert.equal(graph.version, '1.0.0');
  assert.equal(graph.project.name, 'MiniApp');
  assert.equal(graph.project.targetScheme, 'MiniApp');

  const allTasks = graph.getAllTasks();
  assert.equal(allTasks.length, 4);
  assert.deepEqual(allTasks.map(t => t.id), ['task-1', 'task-2', 'task-3', 'task-4']);

  // Check getTask
  const task1 = graph.getTask('task-1');
  assert.ok(task1);
  assert.equal(task1.title, 'Data Models');
  assert.equal(graph.getTask('unknown'), undefined);

  // Check direct dependencies & reverse dependents
  assert.deepEqual(task1.dependencies, []);
  assert.deepEqual(task1.dependents, ['task-2', 'task-3']);

  const task2 = graph.getTask('task-2')!;
  assert.deepEqual(task2.dependencies, ['task-1']);
  assert.deepEqual(task2.dependents, ['task-4']);

  const task3 = graph.getTask('task-3')!;
  assert.deepEqual(task3.dependencies, ['task-1']);
  assert.deepEqual(task3.dependents, ['task-4']);

  const task4 = graph.getTask('task-4')!;
  assert.deepEqual(task4.dependencies, ['task-2', 'task-3']);
  assert.deepEqual(task4.dependents, []);

  // Check helper query methods
  assert.deepEqual(
    graph.getDirectDependencies('task-4').map(t => t.id),
    ['task-2', 'task-3']
  );
  assert.deepEqual(
    graph.getDirectDependents('task-1').map(t => t.id),
    ['task-2', 'task-3']
  );
  assert.deepEqual(graph.getDirectDependencies('task-1'), []);
  assert.deepEqual(graph.getDirectDependents('task-4'), []);
});

test('TaskGraph.getTransitiveDependents returns all downstream nodes in topological order without duplicates', () => {
  const graph = TaskGraph.fromYaml(VALID_DIAMOND_YAML);

  const transitiveFrom1 = graph.getTransitiveDependents('task-1');
  assert.deepEqual(
    transitiveFrom1.map(t => t.id),
    ['task-2', 'task-3', 'task-4']
  );

  const transitiveFrom2 = graph.getTransitiveDependents('task-2');
  assert.deepEqual(
    transitiveFrom2.map(t => t.id),
    ['task-4']
  );

  const transitiveFrom4 = graph.getTransitiveDependents('task-4');
  assert.deepEqual(transitiveFrom4, []);

  assert.deepEqual(graph.getTransitiveDependents('non-existent'), []);
});

test('TaskGraph throws DuplicateTaskIdError when task ID is repeated', () => {
  assert.throws(
    () => TaskGraph.fromYaml(DUPLICATE_ID_YAML),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateTaskIdError);
      assert.equal(err.taskId, 'task-model');
      assert.match(err.message, /Duplicate task ID detected: "task-model"/);
      return true;
    }
  );
});

test('TaskGraph throws CycleDetectedError with cyclePath for 3-node cycle', () => {
  assert.throws(
    () => TaskGraph.fromYaml(CYCLE_YAML),
    (err: unknown) => {
      assert.ok(err instanceof CycleDetectedError);
      assert.deepEqual(err.cyclePath, ['task-a', 'task-b', 'task-c', 'task-a']);
      assert.equal(
        err.message,
        'Cyclic dependency detected: task-a -> task-b -> task-c -> task-a'
      );
      return true;
    }
  );
});

test('TaskGraph throws CycleDetectedError for self-referential cycle', () => {
  assert.throws(
    () => TaskGraph.fromYaml(SELF_CYCLE_YAML),
    (err: unknown) => {
      assert.ok(err instanceof CycleDetectedError);
      assert.deepEqual(err.cyclePath, ['task-self', 'task-self']);
      assert.equal(
        err.message,
        'Cyclic dependency detected: task-self -> task-self'
      );
      return true;
    }
  );
});

test('TaskGraph throws descriptive Error when unknown dependency is referenced', () => {
  assert.throws(
    () => TaskGraph.fromYaml(UNKNOWN_DEP_YAML),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(
        err.message,
        /Unknown dependency "task-non-existent" referenced by task "task-a"/
      );
      return true;
    }
  );
});

test('TaskGraph.computeReadyTasks correctly derives ready tasks from execution status records', () => {
  const graph = TaskGraph.fromYaml(VALID_DIAMOND_YAML);

  // 1. Initially all tasks are PENDING: only task-1 (0 dependencies) is ready
  const records: Record<string, { status: TaskExecutionStatus }> = {
    'task-1': { status: 'PENDING' },
    'task-2': { status: 'PENDING' },
    'task-3': { status: 'PENDING' },
    'task-4': { status: 'PENDING' }
  };
  assert.deepEqual(
    graph.computeReadyTasks(records).map(t => t.id),
    ['task-1']
  );

  // 2. task-1 SUCCEEDED: task-2 and task-3 become READY
  records['task-1'] = { status: 'SUCCEEDED' };
  assert.deepEqual(
    graph.computeReadyTasks(records).map(t => t.id),
    ['task-2', 'task-3']
  );

  // 3. task-2 SUCCEEDED, but task-3 is RUNNING: task-4 is NOT ready because task-3 is not SUCCEEDED
  records['task-2'] = { status: 'SUCCEEDED' };
  records['task-3'] = { status: 'RUNNING' };
  assert.deepEqual(
    graph.computeReadyTasks(records).map(t => t.id),
    []
  );

  // 4. task-3 SUCCEEDED: now both dependencies of task-4 are SUCCEEDED, so task-4 is ready
  records['task-3'] = { status: 'SUCCEEDED' };
  assert.deepEqual(
    graph.computeReadyTasks(records).map(t => t.id),
    ['task-4']
  );

  // 5. task-4 SUCCEEDED: no more tasks are ready
  records['task-4'] = { status: 'SUCCEEDED' };
  assert.deepEqual(graph.computeReadyTasks(records), []);

  // 6. If task-4 is BLOCKED, it is not ready
  records['task-4'] = { status: 'BLOCKED' };
  assert.deepEqual(graph.computeReadyTasks(records), []);
});
