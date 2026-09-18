import test from 'node:test';
import assert from 'node:assert/strict';
import { CascadeExecutionPolicy } from '../../../src/dag/cascade-execution-policy.ts';
import type { IExecutionPolicy } from '../../../src/dag/execution-policy.interface.ts';
import { TaskGraph } from '../../../src/dag/task-graph.ts';
import { FailureDecision, type TaskError, type TaskNode } from '../../../src/dag/types.ts';

const DIAMOND_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-a"
    title: "Task A - Root"
    goal: "Base setup"
    role: "Architect"
    dependencies: []
    allowed_files: ["A.swift"]
    acceptance_criteria: ["Setup done"]
    verification:
      build: true
  - id: "task-b"
    title: "Task B - Branch 1"
    goal: "Feature B"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["B.swift"]
    acceptance_criteria: ["Feature B done"]
    verification:
      build: true
  - id: "task-c"
    title: "Task C - Parallel Branch 2"
    goal: "Feature C"
    role: "iOS Developer"
    dependencies: ["task-a"]
    allowed_files: ["C.swift"]
    acceptance_criteria: ["Feature C done"]
    verification:
      build: true
  - id: "task-d"
    title: "Task D - Convergent Downstream"
    goal: "Combine B and C"
    role: "iOS Developer"
    dependencies: ["task-b", "task-c"]
    allowed_files: ["D.swift"]
    acceptance_criteria: ["Integration done"]
    verification:
      build: true
`;

const DEEP_BRANCHES_YAML = `
version: "1.0.0"
project:
  name: "MiniApp"
  targetScheme: "MiniApp"
tasks:
  - id: "task-root"
    title: "Root Task"
    goal: "Init"
    role: "Architect"
    dependencies: []
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-b1"
    title: "Branch 1 Step 1"
    goal: "B1"
    role: "iOS Developer"
    dependencies: ["task-root"]
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-b2"
    title: "Branch 1 Step 2"
    goal: "B2"
    role: "iOS Developer"
    dependencies: ["task-b1"]
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-c1"
    title: "Branch 2 Step 1"
    goal: "C1"
    role: "iOS Developer"
    dependencies: ["task-root"]
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
  - id: "task-c2"
    title: "Branch 2 Step 2"
    goal: "C2"
    role: "iOS Developer"
    dependencies: ["task-c1"]
    allowed_files: []
    acceptance_criteria: []
    verification:
      build: true
`;

test('CascadeExecutionPolicy implements IExecutionPolicy and returns CASCADE_BLOCK_AND_CONTINUE', () => {
  const policy: IExecutionPolicy = new CascadeExecutionPolicy();
  const graph = TaskGraph.fromYaml(DIAMOND_YAML);
  const taskB = graph.getTask('task-b')!;
  const error: TaskError = {
    type: 'BUILD_FAILURE',
    message: 'Compilation failed with error: cannot find type UserProfile in scope',
    details: { exitCode: 1 }
  };

  const decision = policy.onTaskFailure(taskB, error, graph);

  assert.equal(decision, FailureDecision.CASCADE_BLOCK_AND_CONTINUE);
});

test('CascadeExecutionPolicy is a pure function that does not mutate task, error, or graph', () => {
  const policy = new CascadeExecutionPolicy();
  const graph = TaskGraph.fromYaml(DIAMOND_YAML);
  const taskB = graph.getTask('task-b')!;
  const taskBSnapshot = JSON.stringify(taskB);
  const graphSnapshot = JSON.stringify(graph.getAllTasks());
  const error: TaskError = {
    type: 'VERIFICATION_ERROR',
    message: 'Visual diff exceeded tolerance threshold',
    details: { delta: 12.5 }
  };
  const errorSnapshot = JSON.stringify(error);

  const decision = policy.onTaskFailure(taskB, error, graph);

  assert.equal(decision, FailureDecision.CASCADE_BLOCK_AND_CONTINUE);
  assert.equal(JSON.stringify(taskB), taskBSnapshot);
  assert.equal(JSON.stringify(error), errorSnapshot);
  assert.equal(JSON.stringify(graph.getAllTasks()), graphSnapshot);
});

test('CascadeExecutionPolicy paired with TaskGraph.getTransitiveDependents in diamond graph blocks downstream but keeps parallel branch untouched', () => {
  const policy = new CascadeExecutionPolicy();
  const graph = TaskGraph.fromYaml(DIAMOND_YAML);

  const taskB = graph.getTask('task-b')!;
  const error: TaskError = {
    type: 'TEST_FAILURE',
    message: 'Unit test failed'
  };

  // 1. Policy determines decision
  const decision = policy.onTaskFailure(taskB, error, graph);
  assert.equal(decision, FailureDecision.CASCADE_BLOCK_AND_CONTINUE);

  // 2. Scheduler uses graph.getTransitiveDependents to derive blocked set
  const blockedDependents = graph.getTransitiveDependents(taskB.id);
  const blockedIds = blockedDependents.map(t => t.id);

  // Downstream task-d MUST be blocked because it depends on task-b
  assert.ok(blockedIds.includes('task-d'), 'Downstream task-d must be in blocked set');

  // Parallel branch task-c MUST NOT be blocked
  assert.ok(!blockedIds.includes('task-c'), 'Parallel branch task-c must NOT be in blocked set');

  // task-a is upstream and MUST NOT be blocked
  assert.ok(!blockedIds.includes('task-a'), 'Upstream task-a must NOT be in blocked set');

  assert.deepEqual(blockedIds, ['task-d']);
});

test('CascadeExecutionPolicy paired with TaskGraph.getTransitiveDependents isolates multi-level branches', () => {
  const policy = new CascadeExecutionPolicy();
  const graph = TaskGraph.fromYaml(DEEP_BRANCHES_YAML);

  const taskB1 = graph.getTask('task-b1')!;
  const error: TaskError = {
    type: 'RUNTIME_CRASH',
    message: 'EXC_BAD_ACCESS in Task B1'
  };

  const decision = policy.onTaskFailure(taskB1, error, graph);
  assert.equal(decision, FailureDecision.CASCADE_BLOCK_AND_CONTINUE);

  const blockedIds = graph.getTransitiveDependents(taskB1.id).map(t => t.id);

  // All downstream descendants of B1 must be blocked: task-b2
  assert.deepEqual(blockedIds, ['task-b2']);

  // Entire Branch 2 (C1, C2) and Root must remain untouched
  assert.ok(!blockedIds.includes('task-c1'));
  assert.ok(!blockedIds.includes('task-c2'));
  assert.ok(!blockedIds.includes('task-root'));
});
