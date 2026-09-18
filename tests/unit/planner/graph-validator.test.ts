import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GraphValidator } from '../../../src/planner/graph-validator.ts';
import type { TaskGraphConfig } from '../../../src/dag/types.ts';

describe('GraphValidator', () => {
  const baseValidConfig: TaskGraphConfig = {
    version: '1.0.0',
    project: {
      name: 'MiniApp',
      targetScheme: 'MiniApp',
    },
    tasks: [
      {
        id: 'task-model',
        title: 'Greeting Model',
        goal: 'Define greeting model',
        role: 'iOS Developer',
        dependencies: [],
        dependents: [],
        allowed_files: ['MiniApp/Greeting.swift'],
        acceptance_criteria: ['Model conforms to Codable'],
        verification: { build: true },
      },
      {
        id: 'task-view',
        title: 'Greeting View',
        goal: 'Render greeting card',
        role: 'iOS Developer',
        dependencies: ['task-model'],
        dependents: [],
        allowed_files: ['MiniApp/GreetingView.swift'],
        acceptance_criteria: ['Card renders cleanly'],
        verification: {
          build: true,
          visual: {
            reference: 'references/card.png',
            focus: 'Card layout',
          },
        },
      },
    ],
  };

  test('valid configuration returns valid true with zero error diagnostics', () => {
    const report = GraphValidator.validate(baseValidConfig);
    assert.equal(report.valid, true);
    assert.equal(report.diagnostics.filter((d) => d.severity === 'error').length, 0);
  });

  test('flags missing project name or scheme', () => {
    const config: TaskGraphConfig = {
      ...baseValidConfig,
      project: { name: '', targetScheme: '' },
    };
    const report = GraphValidator.validate(config);
    assert.equal(report.valid, false);
    assert.ok(report.diagnostics.some((d) => d.rule === 'schema.project.name'));
    assert.ok(report.diagnostics.some((d) => d.rule === 'schema.project.targetScheme'));
  });

  test('flags cyclic dependency in task graph', () => {
    const config: TaskGraphConfig = {
      ...baseValidConfig,
      tasks: [
        {
          ...baseValidConfig.tasks[0],
          dependencies: ['task-view'],
        },
        {
          ...baseValidConfig.tasks[1],
          dependencies: ['task-model'],
        },
      ],
    };
    const report = GraphValidator.validate(config);
    assert.equal(report.valid, false);
    assert.ok(report.diagnostics.some((d) => d.rule === 'dag.cycle_detected'));
  });

  test('flags empty allowed_files', () => {
    const config: TaskGraphConfig = {
      ...baseValidConfig,
      tasks: [
        {
          ...baseValidConfig.tasks[0],
          allowed_files: [],
        },
      ],
    };
    const report = GraphValidator.validate(config);
    assert.equal(report.valid, false);
    assert.ok(report.diagnostics.some((d) => d.rule === 'task.allowed_files.empty'));
  });

  test('flags file boundary overlap conflict between independent concurrent tasks', () => {
    const config: TaskGraphConfig = {
      ...baseValidConfig,
      tasks: [
        {
          id: 'task-1',
          title: 'Task 1',
          goal: 'Edit Shared.swift',
          role: 'iOS Developer',
          dependencies: [],
          dependents: [],
          allowed_files: ['MiniApp/Shared.swift'],
          acceptance_criteria: ['Pass'],
          verification: { build: true },
        },
        {
          id: 'task-2',
          title: 'Task 2',
          goal: 'Also edit Shared.swift independently',
          role: 'iOS Developer',
          dependencies: [], // No dependency on task-1!
          dependents: [],
          allowed_files: ['MiniApp/Shared.swift'],
          acceptance_criteria: ['Pass'],
          verification: { build: true },
        },
      ],
    };
    const report = GraphValidator.validate(config);
    assert.equal(report.valid, false);
    assert.ok(report.diagnostics.some((d) => d.rule === 'task.file_boundary.overlap_conflict'));
  });

  test('permits file overlap when causal dependency exists', () => {
    const config: TaskGraphConfig = {
      ...baseValidConfig,
      tasks: [
        {
          id: 'task-1',
          title: 'Task 1',
          goal: 'Initial edit',
          role: 'iOS Developer',
          dependencies: [],
          dependents: [],
          allowed_files: ['MiniApp/Shared.swift'],
          acceptance_criteria: ['Pass'],
          verification: { build: true },
        },
        {
          id: 'task-2',
          title: 'Task 2',
          goal: 'Subsequent edit',
          role: 'iOS Developer',
          dependencies: ['task-1'], // Dependent on task-1!
          dependents: [],
          allowed_files: ['MiniApp/Shared.swift'],
          acceptance_criteria: ['Pass'],
          verification: { build: true },
        },
      ],
    };
    const report = GraphValidator.validate(config);
    assert.equal(report.valid, true);
  });

  test('flags visual verification missing reference image path', () => {
    const config: TaskGraphConfig = {
      ...baseValidConfig,
      tasks: [
        {
          ...baseValidConfig.tasks[0],
          verification: {
            visual: {
              reference: '',
            },
          },
        },
      ],
    };
    const report = GraphValidator.validate(config);
    assert.equal(report.valid, false);
    assert.ok(report.diagnostics.some((d) => d.rule === 'task.verification.visual.reference'));
  });
});
