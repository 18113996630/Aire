import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDagTaskPrompt } from '../../../src/dag/prompt-builder-dag.ts';
import type { TaskNode, TaskResult } from '../../../src/dag/types.ts';

describe('buildDagTaskPrompt', () => {
  const sampleTask: TaskNode = {
    id: 'task-ui-list',
    title: 'Implement Item List View',
    goal: 'Create SwiftUI ItemListView with SwiftData query',
    non_goals: ['Do not implement item detail navigation', 'Do not add cloud sync'],
    role: 'iOS Developer',
    dependencies: ['task-data-models'],
    dependents: ['task-integration-test'],
    allowed_files: ['Views/ItemListView.swift', 'Views/ItemRowView.swift'],
    acceptance_criteria: [
      'ItemListView renders SwiftData Query items correctly',
      'Empty state is shown when items array is empty',
      'Compiles with zero warnings on iOS 17 target',
    ],
    verification: {
      build: true,
      visual: {
        reference: 'docs/references/list-view.png',
      },
    },
    max_retries: 3,
  };

  const sampleDepResult1: TaskResult = {
    taskId: 'task-data-models',
    title: 'Define Data Models',
    goal: 'Define SwiftData schemas and persistence stack',
    status: 'SUCCEEDED',
    summary: 'Created Item model and registered SwiftData container',
    changedFiles: ['Models/Item.swift', 'App/AppSchema.swift'],
    artifacts: ['docs/models.md'],
    apiContracts: ['Item', 'ItemSchemaVersion'],
    baseCommit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    commit: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    completedAt: '2026-09-18T10:00:00.000Z',
  };

  const sampleDepResult2: TaskResult = {
    taskId: 'task-design-tokens',
    title: 'Define Design Tokens',
    goal: 'Extract colors and typography from reference screenshot',
    status: 'SUCCEEDED',
    summary: 'Exported ThemeColor and ThemeFont extensions',
    changedFiles: ['Theme/ThemeColor.swift'],
    artifacts: ['docs/design-tokens.md'],
    apiContracts: ['ThemeColor', 'ThemeFont'],
    baseCommit: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    commit: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    completedAt: '2026-09-18T10:30:00.000Z',
  };

  it('Case 1: formats current task declaration including ID, Title, Role, Goal, Non-Goals, Allowed Files, and Acceptance Criteria', () => {
    const prompt = buildDagTaskPrompt(sampleTask, []);

    // Verify task identity and meta
    assert.match(prompt, /task-ui-list/);
    assert.match(prompt, /Implement Item List View/);
    assert.match(prompt, /iOS Developer/);
    assert.match(prompt, /Create SwiftUI ItemListView with SwiftData query/);

    // Verify non-goals
    assert.match(prompt, /Do not implement item detail navigation/);
    assert.match(prompt, /Do not add cloud sync/);

    // Verify allowed files
    assert.match(prompt, /Views\/ItemListView\.swift/);
    assert.match(prompt, /Views\/ItemRowView\.swift/);

    // Verify acceptance criteria
    assert.match(prompt, /ItemListView renders SwiftData Query items correctly/);
    assert.match(prompt, /Empty state is shown when items array is empty/);
    assert.match(prompt, /Compiles with zero warnings on iOS 17 target/);
  });

  it('Case 2: injects all direct dependency TaskResults with summary, changed files, commit, api contracts, and artifacts', () => {
    const prompt = buildDagTaskPrompt(sampleTask, [sampleDepResult1, sampleDepResult2]);

    // Dep 1
    assert.match(prompt, /task-data-models/);
    assert.match(prompt, /Define Data Models/);
    assert.match(prompt, /Define SwiftData schemas and persistence stack/);
    assert.match(prompt, /b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3/);
    assert.match(prompt, /Created Item model and registered SwiftData container/);
    assert.match(prompt, /Models\/Item\.swift/);
    assert.match(prompt, /App\/AppSchema\.swift/);
    assert.match(prompt, /ItemSchemaVersion/);
    assert.match(prompt, /docs\/models\.md/);

    // Dep 2
    assert.match(prompt, /task-design-tokens/);
    assert.match(prompt, /Define Design Tokens/);
    assert.match(prompt, /c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/);
    assert.match(prompt, /Theme\/ThemeColor\.swift/);
    assert.match(prompt, /ThemeFont/);
    assert.match(prompt, /docs\/design-tokens\.md/);
  });

  it('Case 3: injects explicit truth-source guideline: "Git 工作区代码是唯一的真实事实源"', () => {
    const prompt = buildDagTaskPrompt(sampleTask, [sampleDepResult1]);

    assert.match(prompt, /Git 工作区代码是唯一的真实事实源/);
    assert.match(prompt, /请参考上述变更文件直接查阅源码与模型定义/);
  });

  it('Case 4: outputs only own task declaration and criteria when direct dependencies are empty or omitted', () => {
    const promptWithEmptyArray = buildDagTaskPrompt(sampleTask, []);
    const promptWithDefault = buildDagTaskPrompt(sampleTask);

    for (const prompt of [promptWithEmptyArray, promptWithDefault]) {
      // Must have own declaration
      assert.match(prompt, /task-ui-list/);
      assert.match(prompt, /验收条件/);

      // Must NOT have dependencies section or broken headings
      assert.doesNotMatch(prompt, /前置直接依赖/);
      assert.doesNotMatch(prompt, /Direct Dependencies/);
      assert.doesNotMatch(prompt, /undefined/);
      assert.doesNotMatch(prompt, /null/);
      assert.doesNotMatch(prompt, /依赖任务/);
    }
  });

  it('omits non-goals section cleanly when task.non_goals is undefined or empty', () => {
    const taskWithoutNonGoals: TaskNode = {
      ...sampleTask,
      non_goals: undefined,
    };
    const prompt1 = buildDagTaskPrompt(taskWithoutNonGoals, []);
    assert.doesNotMatch(prompt1, /非目标/);
    assert.doesNotMatch(prompt1, /Non-Goals/);

    const taskWithEmptyNonGoals: TaskNode = {
      ...sampleTask,
      non_goals: [],
    };
    const prompt2 = buildDagTaskPrompt(taskWithEmptyNonGoals, []);
    assert.doesNotMatch(prompt2, /非目标/);
    assert.doesNotMatch(prompt2, /Non-Goals/);
  });

  it('handles dependency with optional or empty apiContracts and artifacts gracefully', () => {
    const minimalDepResult: TaskResult = {
      taskId: 'task-minimal',
      title: 'Minimal Task',
      goal: 'Minimal Goal',
      status: 'SUCCEEDED',
      summary: 'Minimal Summary',
      changedFiles: ['Utils/Helper.swift'],
      artifacts: [],
      apiContracts: undefined,
      baseCommit: '1111111111111111111111111111111111111111',
      commit: '2222222222222222222222222222222222222222',
      completedAt: '2026-09-18T11:00:00.000Z',
    };

    const prompt = buildDagTaskPrompt(sampleTask, [minimalDepResult]);
    assert.match(prompt, /task-minimal/);
    assert.match(prompt, /Utils\/Helper\.swift/);
    assert.doesNotMatch(prompt, /undefined/);
    assert.doesNotMatch(prompt, /null/);
  });
});
