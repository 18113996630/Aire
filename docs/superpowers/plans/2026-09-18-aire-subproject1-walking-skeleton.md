# AIRE Sub-project 1: Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 AIRE 的最小可用闭环（Walking Skeleton）：接收单任务输入，驱动本地 AI Coding CLI 修改 iOS 代码，调用 `xcodebuild` 编译，并在报错时自动捕获结构化错误进行针对性自愈修复，最终自动提交代码或回滚。

**Architecture:** 采用有限状态机（FSM）驱动整个生命周期，通过 `ICliAdapter` 抽象与本地 CLI 进程通信，通过 `IEvaluator` 管道统一编译/评审反馈，由 `SwiftErrorParser` 精准提炼编译器报错并组装轻量 Fix Prompt，最后通过 `GitManager` 保障工作区单向安全回退。

**Tech Stack:** TypeScript, Node.js (v25+), Commander.js, Native `node:test` + `node:assert`, Git, Xcode (`xcodebuild`).

> **注意（Runtime 矩阵调整）：** 系统已根据最新架构决策移除 OpenCode 支持，统一支持 **Codex**、**Antigravity** 和 **Cursor** 作为标准 Coding Agent Runtime。

**Spec:** [`docs/superpowers/specs/2026-09-18-aire-subproject1-walking-skeleton-design.md`](../specs/2026-09-18-aire-subproject1-walking-skeleton-design.md)

## Global Constraints

- PATH 必须包含 Node 环境（如 `/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH`）与系统命令。
- 所有代码均采用 TypeScript 编写，严格遵循单一职责与清晰模块边界。
- 绝不直接向 AI 发送原始未清洗的完整 Xcode 编译日志；所有日志必须经 `SwiftErrorParser` 过滤。
- 状态机必须具备硬性重试上限（默认 3 次），耗尽时强制执行 Git 回滚，保护源码安全。
- 每一个功能模块必须具备独立的单元测试（TDD 开发）。

---

### Task 1: 工程脚手架与基础环境配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore` (update existing if needed)

**Interfaces:**
- Consumes: Node.js v25+ runtime.
- Produces: `npm run test` 与 `npm run build` 命令。

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "aire",
  "version": "0.1.0",
  "description": "AI iOS App Replica Engine",
  "type": "module",
  "bin": {
    "aire": "./bin/aire.js"
  },
  "scripts": {
    "test": "node --experimental-strip-types --test tests/unit/*.test.ts tests/integration/*.test.ts",
    "test:unit": "node --experimental-strip-types --test tests/unit/*.test.ts",
    "test:integration": "node --experimental-strip-types --test tests/integration/*.test.ts",
    "test:e2e": "node --experimental-strip-types --test tests/e2e/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^13.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*", "bin/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: 安装依赖并验证环境**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && npm install`
Expected: 成功生成 `node_modules` 和 `package-lock.json`。

- [ ] **Step 4: 运行类型检查验证配置**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && npm run typecheck`
Expected: PASS (退出码 0)。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: initialize TypeScript project scaffolding and npm scripts"
```

---

### Task 2: 核心数据模型与任务上下文（Types & Context）

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/context.ts`
- Test: `tests/unit/context.test.ts`

**Interfaces:**
- Consumes: None.
- Produces: `TaskState`, `BuildError`, `EvaluationResult`, `TaskContext`, `createTaskContext()`.

- [ ] **Step 1: 编写失败的单元测试**

在 `tests/unit/context.test.ts` 中写入：
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskContext, recordIteration } from '../../src/core/context.ts';

describe('TaskContext', () => {
  test('createTaskContext initializes with default values', () => {
    const ctx = createTaskContext({
      taskId: 'TASK-001',
      projectPath: '/path/to/project',
      scheme: 'MiniApp',
      taskGoal: 'Add counter button'
    });

    assert.equal(ctx.taskId, 'TASK-001');
    assert.equal(ctx.state, 'IDLE');
    assert.equal(ctx.currentRetry, 0);
    assert.equal(ctx.maxRetries, 3);
    assert.equal(ctx.history.length, 0);
  });

  test('recordIteration adds history entry and increments retry', () => {
    const ctx = createTaskContext({
      taskId: 'TASK-002',
      projectPath: '/path/to/project',
      scheme: 'MiniApp',
      taskGoal: 'Fix view'
    });

    recordIteration(ctx, {
      action: 'INITIAL_PROMPT',
      promptUsed: 'Make view red',
      cliSummary: 'Modified ContentView.swift'
    });

    assert.equal(ctx.history.length, 1);
    assert.equal(ctx.history[0].iteration, 1);
    assert.equal(ctx.history[0].action, 'INITIAL_PROMPT');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/context.test.ts`
Expected: FAIL (模块不存在)。

- [ ] **Step 3: 实现 `src/core/types.ts` 与 `src/core/context.ts`**

在 `src/core/types.ts` 中：
```typescript
export type TaskState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'AGENT_CODING'
  | 'BUILDING'
  | 'EVALUATING'
  | 'FIXING'
  | 'COMMITTING'
  | 'ROLLING_BACK'
  | 'COMPLETED'
  | 'FAILED';

export interface BuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  rawSnippet?: string;
}

export interface EvaluationResult {
  passed: boolean;
  type: 'BUILD' | 'FUNCTIONAL' | 'VISUAL_REVIEW';
  summary: string;
  errors: BuildError[];
}

export interface TaskHistoryItem {
  iteration: number;
  action: 'INITIAL_PROMPT' | 'FIX_PROMPT';
  promptUsed: string;
  cliSummary?: string;
  evaluationResult?: EvaluationResult;
  timestamp: number;
}

export interface TaskContext {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries: number;
  currentRetry: number;
  state: TaskState;
  branchName?: string;
  initialCommitSha?: string;
  history: TaskHistoryItem[];
}
```

在 `src/core/context.ts` 中：
```typescript
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/context.test.ts`
Expected: PASS (所有断言通过)。

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/context.ts tests/unit/context.test.ts
git commit -m "feat(core): implement core types and task context"
```

---

### Task 3: Swift 编译日志错误清洗器（SwiftErrorParser）

**Files:**
- Create: `src/evaluator/swift-error-parser.ts`
- Test: `tests/unit/swift-error-parser.test.ts`

**Interfaces:**
- Consumes: `rawLog: string`.
- Produces: `parseSwiftErrors(rawLog: string): BuildError[]`.

- [ ] **Step 1: 编写失败的单元测试**

在 `tests/unit/swift-error-parser.test.ts` 中：
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwiftErrors } from '../../src/evaluator/swift-error-parser.ts';

describe('SwiftErrorParser', () => {
  test('extracts single compiler error with file, line, and message', () => {
    const rawLog = `
CompileSwift normal arm64 /Users/test/Sources/ContentView.swift
/Users/test/Sources/ContentView.swift:42:15: error: cannot find 'InvalidButton' in scope
    InvalidButton()
    ^~~~~~~~~~~~~
** BUILD FAILED **
`;
    const errors = parseSwiftErrors(rawLog);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].file, '/Users/test/Sources/ContentView.swift');
    assert.equal(errors[0].line, 42);
    assert.equal(errors[0].column, 15);
    assert.equal(errors[0].message, "cannot find 'InvalidButton' in scope");
  });

  test('extracts multiple distinct compiler errors', () => {
    const rawLog = `
/App/Model.swift:10:5: error: expected identifier in property declaration
/App/ContentView.swift:20:12: error: value of type 'State' has no member 'count'
`;
    const errors = parseSwiftErrors(rawLog);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].file, '/App/Model.swift');
    assert.equal(errors[1].file, '/App/ContentView.swift');
  });

  test('returns empty array when build succeeds with no errors', () => {
    const rawLog = `
** BUILD SUCCEEDED **
`;
    const errors = parseSwiftErrors(rawLog);
    assert.equal(errors.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/swift-error-parser.test.ts`
Expected: FAIL (模块不存在)。

- [ ] **Step 3: 实现 `src/evaluator/swift-error-parser.ts`**

```typescript
import type { BuildError } from '../core/types.ts';

const SWIFT_ERROR_REGEX = /^(?<file>.+\.swift):(?<line>\d+):(?<column>\d+):\s+error:\s+(?<message>.+)$/gm;

export function parseSwiftErrors(rawLog: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = rawLog.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SWIFT_ERROR_REGEX.lastIndex = 0;
    const match = SWIFT_ERROR_REGEX.exec(line);
    if (match && match.groups) {
      // 尝试捕获代码片段上下文（如果有下一行）
      let snippet: string | undefined;
      if (i + 1 < lines.length && !lines[i + 1].includes(': error:')) {
        snippet = lines[i + 1].trim();
      }

      errors.push({
        file: match.groups.file,
        line: parseInt(match.groups.line, 10),
        column: parseInt(match.groups.column, 10),
        message: match.groups.message.trim(),
        rawSnippet: snippet
      });
    }
  }

  return errors;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/swift-error-parser.test.ts`
Expected: PASS (全部通过)。

- [ ] **Step 5: Commit**

```bash
git add src/evaluator/swift-error-parser.ts tests/unit/swift-error-parser.test.ts
git commit -m "feat(evaluator): implement Swift error log parser"
```

---

### Task 4: Evaluator 统一抽象与 XcodeBuild 评测器

**Files:**
- Create: `src/evaluator/evaluator.interface.ts`
- Create: `src/evaluator/xcodebuild.ts`
- Test: `tests/unit/xcodebuild.test.ts`

**Interfaces:**
- Consumes: `TaskContext`, `parseSwiftErrors`.
- Produces: `IEvaluator`, `XcodeBuildEvaluator`.

- [ ] **Step 1: 编写失败的单元测试**

在 `tests/unit/xcodebuild.test.ts` 中：
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { XcodeBuildEvaluator } from '../../src/evaluator/xcodebuild.ts';
import { createTaskContext } from '../../src/core/context.ts';

describe('XcodeBuildEvaluator', () => {
  test('evaluate parses mocked failed xcodebuild execution', async () => {
    // 注入 mock 运行器模拟 xcodebuild 行为
    const mockRunner = async () => ({
      exitCode: 65,
      stdout: `/Path/ContentView.swift:15:3: error: missing return in closure\n** BUILD FAILED **`,
      stderr: ''
    });

    const evaluator = new XcodeBuildEvaluator({ runner: mockRunner });
    const ctx = createTaskContext({
      taskId: 'T-001',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'test'
    });

    const result = await evaluator.evaluate(ctx);
    assert.equal(result.passed, false);
    assert.equal(result.type, 'BUILD');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].line, 15);
  });

  test('evaluate returns passed true on success', async () => {
    const mockRunner = async () => ({
      exitCode: 0,
      stdout: `** BUILD SUCCEEDED **`,
      stderr: ''
    });

    const evaluator = new XcodeBuildEvaluator({ runner: mockRunner });
    const ctx = createTaskContext({
      taskId: 'T-002',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'test'
    });

    const result = await evaluator.evaluate(ctx);
    assert.equal(result.passed, true);
    assert.equal(result.errors.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/xcodebuild.test.ts`
Expected: FAIL (模块不存在)。

- [ ] **Step 3: 实现 `src/evaluator/evaluator.interface.ts` 与 `src/evaluator/xcodebuild.ts`**

在 `src/evaluator/evaluator.interface.ts` 中：
```typescript
import type { TaskContext, EvaluationResult } from '../core/types.ts';

export interface IEvaluator {
  readonly name: string;
  evaluate(context: TaskContext): Promise<EvaluationResult>;
}
```

在 `src/evaluator/xcodebuild.ts` 中：
```typescript
import { spawn } from 'node:child_process';
import type { TaskContext, EvaluationResult } from '../core/types.ts';
import type { IEvaluator } from './evaluator.interface.ts';
import { parseSwiftErrors } from './swift-error-parser.ts';

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}) => Promise<ProcessRunResult>;

export const defaultProcessRunner: ProcessRunner = ({ command, args, cwd, timeoutMs = 180000 }) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
};

export class XcodeBuildEvaluator implements IEvaluator {
  readonly name = 'XcodeBuild';
  private runner: ProcessRunner;

  constructor(options?: { runner?: ProcessRunner }) {
    this.runner = options?.runner ?? defaultProcessRunner;
  }

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    const args = [
      '-scheme', context.scheme,
      '-destination', 'generic/platform=iOS Simulator',
      'clean', 'build'
    ];

    try {
      const result = await this.runner({
        command: 'xcodebuild',
        args,
        cwd: context.projectPath
      });

      if (result.exitCode === 0) {
        return {
          passed: true,
          type: 'BUILD',
          summary: 'Build succeeded cleanly',
          errors: []
        };
      }

      const combinedLog = result.stdout + '\n' + result.stderr;
      const errors = parseSwiftErrors(combinedLog);

      return {
        passed: false,
        type: 'BUILD',
        summary: errors.length > 0
          ? `Build failed with ${errors.length} compiler error(s)`
          : `Build failed with exit code ${result.exitCode}`,
        errors
      };
    } catch (err: any) {
      return {
        passed: false,
        type: 'BUILD',
        summary: `xcodebuild execution error: ${err.message}`,
        errors: []
      };
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/xcodebuild.test.ts`
Expected: PASS (全部通过)。

- [ ] **Step 5: Commit**

```bash
git add src/evaluator/evaluator.interface.ts src/evaluator/xcodebuild.ts tests/unit/xcodebuild.test.ts
git commit -m "feat(evaluator): implement XcodeBuildEvaluator with pluggable runner"
```

---

### Task 5: 版本控制与安全回滚管理器（GitManager）

**Files:**
- Create: `src/vcs/git-manager.ts`
- Test: `tests/unit/git-manager.test.ts`

**Interfaces:**
- Consumes: Git CLI, filesystem path.
- Produces: `GitManager` (isClean, getCurrentCommitSha, commitChanges, hardReset).

- [ ] **Step 1: 编写失败的单元测试**

在 `tests/unit/git-manager.test.ts` 中：
```typescript
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { GitManager } from '../../src/vcs/git-manager.ts';

describe('GitManager', () => {
  let testRepoDir: string;

  beforeEach(() => {
    testRepoDir = mkdtempSync(join(tmpdir(), 'aire-git-test-'));
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.name "Test"', { cwd: testRepoDir });
    execSync('git config user.email "test@test.com"', { cwd: testRepoDir });
    writeFileSync(join(testRepoDir, 'README.md'), '# Initial');
    execSync('git add . && git commit -m "initial commit"', { cwd: testRepoDir });
  });

  afterEach(() => {
    rmSync(testRepoDir, { recursive: true, force: true });
  });

  test('detects clean working directory and returns head commit sha', async () => {
    const git = new GitManager(testRepoDir);
    assert.equal(await git.isClean(), true);
    const sha = await git.getHeadSha();
    assert.match(sha, /^[a-f0-9]{40}$/);
  });

  test('commits changes cleanly with custom message', async () => {
    const git = new GitManager(testRepoDir);
    writeFileSync(join(testRepoDir, 'Feature.swift'), '// code');
    assert.equal(await git.isClean(), false);

    const newSha = await git.commitChanges('feat: add feature');
    assert.match(newSha, /^[a-f0-9]{40}$/);
    assert.equal(await git.isClean(), true);
  });

  test('resets hard to a previous commit sha on rollback', async () => {
    const git = new GitManager(testRepoDir);
    const initialSha = await git.getHeadSha();

    writeFileSync(join(testRepoDir, 'BadCode.swift'), '// corrupted');
    await git.commitChanges('feat: bad code');

    await git.hardReset(initialSha);
    assert.equal(await git.getHeadSha(), initialSha);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/git-manager.test.ts`
Expected: FAIL (模块不存在)。

- [ ] **Step 3: 实现 `src/vcs/git-manager.ts`**

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class GitManager {
  constructor(private readonly repoPath: string) {}

  private async runGit(cmd: string): Promise<string> {
    const { stdout } = await execAsync(`git ${cmd}`, { cwd: this.repoPath });
    return stdout.trim();
  }

  async isClean(): Promise<boolean> {
    const status = await this.runGit('status --porcelain');
    return status.length === 0;
  }

  async getHeadSha(): Promise<string> {
    return this.runGit('rev-parse HEAD');
  }

  async createAndCheckoutBranch(branchName: string): Promise<void> {
    await this.runGit(`checkout -b ${branchName}`);
  }

  async commitChanges(message: string): Promise<string> {
    await this.runGit('add -A');
    await this.runGit(`commit -m "${message.replace(/"/g, '\\"')}"`);
    return this.getHeadSha();
  }

  async hardReset(targetSha: string): Promise<void> {
    await this.runGit(`reset --hard ${targetSha}`);
    await this.runGit('clean -fd');
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/git-manager.test.ts`
Expected: PASS (全部通过)。

- [ ] **Step 5: Commit**

```bash
git add src/vcs/git-manager.ts tests/unit/git-manager.test.ts
git commit -m "feat(vcs): implement GitManager for workspace protection and rollback"
```

---

### Task 6: CLI 适配器接口与实现（Mock & OpenCode）

**Files:**
- Create: `src/runtime/adapter.interface.ts`
- Create: `src/runtime/mock.adapter.ts`
- Create: `src/runtime/opencode.adapter.ts`
- Test: `tests/unit/adapter.test.ts`

**Interfaces:**
- Consumes: `ICliAdapter`, `CliExecutionResult`.
- Produces: `MockCliAdapter`, `OpenCodeCliAdapter`.

- [ ] **Step 1: 编写失败的单元测试**

在 `tests/unit/adapter.test.ts` 中：
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';

describe('CliAdapters', () => {
  test('MockCliAdapter executes custom scripted responses per iteration', async () => {
    const adapter = new MockCliAdapter([
      async (params) => ({
        exitCode: 0,
        stdout: 'First modification',
        stderr: '',
        durationMs: 10
      }),
      async (params) => ({
        exitCode: 0,
        stdout: 'Fix applied',
        stderr: '',
        durationMs: 15
      })
    ]);

    assert.equal(await adapter.isAvailable(), true);

    const res1 = await adapter.execute({ cwd: '/test', prompt: 'Initial task' });
    assert.equal(res1.stdout, 'First modification');

    const res2 = await adapter.execute({ cwd: '/test', prompt: 'Fix error' });
    assert.equal(res2.stdout, 'Fix applied');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/adapter.test.ts`
Expected: FAIL (模块不存在)。

- [ ] **Step 3: 实现接口与具体适配器**

在 `src/runtime/adapter.interface.ts` 中：
```typescript
export interface CliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CliExecuteParams {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ICliAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(params: CliExecuteParams): Promise<CliExecutionResult>;
}
```

在 `src/runtime/mock.adapter.ts` 中：
```typescript
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from './adapter.interface.ts';

export type MockBehavior = (params: CliExecuteParams) => Promise<CliExecutionResult>;

export class MockCliAdapter implements ICliAdapter {
  readonly name = 'MockCli';
  private callCount = 0;

  constructor(private behaviors: MockBehavior[] = []) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
    const behavior = this.behaviors[this.callCount] ?? (async () => ({
      exitCode: 0,
      stdout: 'Default mock execution',
      stderr: '',
      durationMs: 5
    }));
    this.callCount++;
    return behavior(params);
  }
}
```

在 `src/runtime/opencode.adapter.ts` 中：
```typescript
import { spawn } from 'node:child_process';
import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from './adapter.interface.ts';

export class OpenCodeCliAdapter implements ICliAdapter {
  readonly name = 'OpenCode';
  private binPath: string;

  constructor(binPath?: string) {
    this.binPath = binPath ?? '/Users/huangrong/.opencode/bin/opencode';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.binPath, ['--version']);
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }

  async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
    const start = Date.now();
    const timeout = params.timeoutMs ?? 300000; // 5 分钟超时

    return new Promise((resolve, reject) => {
      // 使用 prompt 模式调用 opencode
      const child = spawn(this.binPath, ['run', params.prompt], {
        cwd: params.cwd
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`OpenCode timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - start
        });
      });
    });
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/adapter.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/runtime/adapter.interface.ts src/runtime/mock.adapter.ts src/runtime/opencode.adapter.ts tests/unit/adapter.test.ts
git commit -m "feat(runtime): implement ICliAdapter, MockCliAdapter and OpenCodeCliAdapter"
```

---

### Task 7: 自愈提示词生成器与核心状态机调度器

**Files:**
- Create: `src/core/prompt-builder.ts`
- Create: `src/core/state-machine.ts`
- Test: `tests/unit/state-machine.test.ts`

**Interfaces:**
- Consumes: `TaskContext`, `ICliAdapter`, `IEvaluator`, `GitManager`.
- Produces: `FixPromptBuilder`, `StateMachine.run()`.

- [ ] **Step 1: 编写失败的单元测试**

在 `tests/unit/state-machine.test.ts` 中：
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StateMachine } from '../../src/core/state-machine.ts';
import { createTaskContext } from '../../src/core/context.ts';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';

describe('StateMachine', () => {
  test('completes task when build succeeds on first iteration', async () => {
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: true,
        type: 'BUILD',
        summary: 'Build clean',
        errors: []
      })
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: mockEvaluator,
      skipGit: true // 单测跳过真实 git
    });

    const ctx = createTaskContext({
      taskId: 'T-SUCCESS',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Add greeting'
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'COMPLETED');
    assert.equal(finalCtx.currentRetry, 0);
  });

  test('fixes error and completes when second iteration succeeds', async () => {
    const mockCli = new MockCliAdapter();
    let evalCount = 0;
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => {
        evalCount++;
        if (evalCount === 1) {
          return {
            passed: false,
            type: 'BUILD',
            summary: '1 error',
            errors: [{ file: 'ContentView.swift', line: 10, column: 5, message: 'syntax error' }]
          };
        }
        return {
          passed: true,
          type: 'BUILD',
          summary: 'Build clean',
          errors: []
        };
      }
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: mockEvaluator,
      skipGit: true
    });

    const ctx = createTaskContext({
      taskId: 'T-FIX',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Fix view'
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'COMPLETED');
    assert.equal(finalCtx.currentRetry, 1);
  });

  test('fails and terminates when max retries exceeded', async () => {
    const mockCli = new MockCliAdapter();
    const mockEvaluator: IEvaluator = {
      name: 'MockEvaluator',
      evaluate: async () => ({
        passed: false,
        type: 'BUILD',
        summary: 'Always fails',
        errors: [{ file: 'Error.swift', line: 1, column: 1, message: 'fatal error' }]
      })
    };

    const machine = new StateMachine({
      cliAdapter: mockCli,
      evaluator: mockEvaluator,
      skipGit: true
    });

    const ctx = createTaskContext({
      taskId: 'T-FAIL',
      projectPath: '/test',
      scheme: 'MiniApp',
      taskGoal: 'Unfixable task',
      maxRetries: 2
    });

    const finalCtx = await machine.run(ctx);
    assert.equal(finalCtx.state, 'FAILED');
    assert.equal(finalCtx.currentRetry, 2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/state-machine.test.ts`
Expected: FAIL (模块不存在)。

- [ ] **Step 3: 实现 `src/core/prompt-builder.ts` 与 `src/core/state-machine.ts`**

在 `src/core/prompt-builder.ts` 中：
```typescript
import type { BuildError } from './types.ts';

export function buildFixPrompt(errors: BuildError[]): string {
  const errorList = errors
    .map((e, index) => `${index + 1}. 文件: ${e.file} (第 ${e.line} 行)\n   报错: ${e.message}${e.rawSnippet ? `\n   上下文: ${e.rawSnippet}` : ''}`)
    .join('\n\n');

  return `【自动修复任务】
你上一轮的代码修改导致 Xcode 编译失败。请根据以下具体的 Swift 编译器报错进行修复：

[错误清单]
${errorList}

[修复要求]
1. 仅修改与解决上述报错直接相关的代码文件。
2. 确保类型、函数签名和作用域引用正确，保持其他功能不受影响。
3. 请直接更新文件，完成后无需输出多余的客套文字。`;
}
```

在 `src/core/state-machine.ts` 中：
```typescript
import type { TaskContext } from './types.ts';
import { recordIteration } from './context.ts';
import type { ICliAdapter } from '../runtime/adapter.interface.ts';
import type { IEvaluator } from '../evaluator/evaluator.interface.ts';
import { GitManager } from '../vcs/git-manager.ts';
import { buildFixPrompt } from './prompt-builder.ts';

export interface StateMachineOptions {
  cliAdapter: ICliAdapter;
  evaluator: IEvaluator;
  skipGit?: boolean;
}

export class StateMachine {
  private cli: ICliAdapter;
  private evaluator: IEvaluator;
  private skipGit: boolean;

  constructor(options: StateMachineOptions) {
    this.cli = options.cliAdapter;
    this.evaluator = options.evaluator;
    this.skipGit = options.skipGit ?? false;
  }

  async run(ctx: TaskContext): Promise<TaskContext> {
    ctx.state = 'INITIALIZING';
    let git: GitManager | null = null;

    if (!this.skipGit) {
      git = new GitManager(ctx.projectPath);
      ctx.initialCommitSha = await git.getHeadSha();
    }

    let currentPrompt = ctx.taskGoal;
    let isFix = false;

    while (true) {
      // 1. Agent Coding
      ctx.state = isFix ? 'FIXING' : 'AGENT_CODING';
      const cliResult = await this.cli.execute({
        cwd: ctx.projectPath,
        prompt: currentPrompt
      });

      // 2. Building & Evaluating
      ctx.state = 'BUILDING';
      const evalResult = await this.evaluator.evaluate(ctx);
      ctx.state = 'EVALUATING';

      recordIteration(ctx, {
        action: isFix ? 'FIX_PROMPT' : 'INITIAL_PROMPT',
        promptUsed: currentPrompt,
        cliSummary: cliResult.stdout.slice(0, 200),
        evaluationResult: evalResult
      });

      // 3. Evaluation Check
      if (evalResult.passed) {
        ctx.state = 'COMMITTING';
        if (git) {
          await git.commitChanges(`feat(aire): ${ctx.taskGoal}`);
        }
        ctx.state = 'COMPLETED';
        return ctx;
      }

      // 4. Failure Handling & Fix Loop
      ctx.currentRetry++;
      if (ctx.currentRetry >= ctx.maxRetries) {
        ctx.state = 'ROLLING_BACK';
        if (git && ctx.initialCommitSha) {
          await git.hardReset(ctx.initialCommitSha);
        }
        ctx.state = 'FAILED';
        return ctx;
      }

      // 组装下一次修复的 Prompt
      currentPrompt = buildFixPrompt(evalResult.errors);
      isFix = true;
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types --test tests/unit/state-machine.test.ts`
Expected: PASS (3/3 通过)。

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt-builder.ts src/core/state-machine.ts tests/unit/state-machine.test.ts
git commit -m "feat(core): implement prompt builder and core StateMachine fix loop"
```

---

### Task 8: 内置靶场工程（fixtures/MiniApp）与 CLI 入口（bin/aire.ts）

**Files:**
- Create: `fixtures/MiniApp/MiniApp.xcodeproj/*`
- Create: `fixtures/MiniApp/MiniApp/MiniAppApp.swift`
- Create: `fixtures/MiniApp/MiniApp/ContentView.swift`
- Create: `bin/aire.ts`

**Interfaces:**
- Consumes: `StateMachine`, `OpenCodeCliAdapter`, `XcodeBuildEvaluator`.
- Produces: `aire run --task "..." --project "..." --scheme "..."` 命令行工具。

- [ ] **Step 1: 生成极简标准 Xcode 工程 `fixtures/MiniApp`**

通过脚本生成最小有效 Xcode 工程结构，使其支持 `xcodebuild -scheme MiniApp -destination 'generic/platform=iOS Simulator'`。
在 `fixtures/MiniApp/MiniApp/MiniAppApp.swift` 中：
```swift
import SwiftUI

@main
struct MiniAppApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```
在 `fixtures/MiniApp/MiniApp/ContentView.swift` 中：
```swift
import SwiftUI

public struct ContentView: View {
    public init() {}
    public var body: some View {
        VStack {
            Text("MiniApp Initial State")
        }
        .padding()
    }
}
```

- [ ] **Step 2: 验证靶场工程可编译**

Run: `xcodebuild -project fixtures/MiniApp/MiniApp.xcodeproj -scheme MiniApp -destination 'generic/platform=iOS Simulator' clean build`
Expected: `** BUILD SUCCEEDED **`。

- [ ] **Step 3: 编写 CLI 入口 `bin/aire.ts`**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { createTaskContext } from '../src/core/context.ts';
import { StateMachine } from '../src/core/state-machine.ts';
import { OpenCodeCliAdapter } from '../src/runtime/opencode.adapter.ts';
import { XcodeBuildEvaluator } from '../src/evaluator/xcodebuild.ts';

const program = new Command();

program
  .name('aire')
  .description('AI iOS App Replica Engine')
  .version('0.1.0');

program
  .command('run')
  .description('Run a single development task through the auto-fix loop')
  .requiredOption('-t, --task <goal>', 'Task description / goal')
  .requiredOption('-p, --project <path>', 'Path to target iOS project directory')
  .option('-s, --scheme <scheme>', 'Xcode scheme name', 'MiniApp')
  .option('-r, --max-retries <number>', 'Maximum auto-fix attempts', '3')
  .action(async (options) => {
    const projectPath = resolve(process.cwd(), options.project);
    const maxRetries = parseInt(options.maxRetries, 10);

    console.log(`\n🚀 [AIRE] Initializing task: "${options.task}"`);
    console.log(`📁 Project: ${projectPath}`);
    console.log(`⚙️  Scheme: ${options.scheme} | Max Retries: ${maxRetries}\n`);

    const context = createTaskContext({
      taskId: `TASK-${Date.now()}`,
      projectPath,
      scheme: options.scheme,
      taskGoal: options.task,
      maxRetries
    });

    const cliAdapter = new OpenCodeCliAdapter();
    const evaluator = new XcodeBuildEvaluator();
    const machine = new StateMachine({ cliAdapter, evaluator });

    const finalContext = await machine.run(context);

    if (finalContext.state === 'COMPLETED') {
      console.log(`\n✅ [AIRE] Task COMPLETED successfully!`);
      console.log(`🎉 Total iterations: ${finalContext.history.length}`);
      process.exit(0);
    } else {
      console.error(`\n❌ [AIRE] Task FAILED after ${finalContext.currentRetry} retries.`);
      process.exit(1);
    }
  });

program.parse(process.argv);
```

- [ ] **Step 4: 测试 CLI 帮助输出**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && node --experimental-strip-types bin/aire.ts --help`
Expected: 正常输出 `aire run` 命令格式与参数说明。

- [ ] **Step 5: Commit**

```bash
git add fixtures/ bin/aire.ts
git commit -m "feat(cli): add MiniApp fixture and aire run CLI entrypoint"
```

---

### Task 9: 端到端集成测试与真实闭环验证（Integration & E2E）

**Files:**
- Create: `tests/integration/fix-loop.test.ts`
- Create: `tests/e2e/live-opencode.test.ts`

**Interfaces:**
- Consumes: Full system (`StateMachine`, `MiniApp`, `GitManager`).
- Produces: Layer 2 & Layer 3 质量证明。

- [ ] **Step 1: 编写 Layer 2 集成测试（Mock 故障与自愈）**

在 `tests/integration/fix-loop.test.ts` 中：
- 复制 `fixtures/MiniApp` 至临时测试目录。
- 初始化 git 仓库。
- 使用 `MockCliAdapter`：
  - Round 1: 向 `ContentView.swift` 写入包含语法错误的代码（故意导致编译失败）。
  - Round 2: 修复 `ContentView.swift` 为合法 SwiftUI 代码。
- 接入真实的 `XcodeBuildEvaluator` 和 `GitManager`。
- 启动 `StateMachine.run()`。
- 断言：
  - 任务状态最终为 `COMPLETED`。
  - Git 生成了真实的 commit。
  - ContentView.swift 最终为修复后的代码。

- [ ] **Step 2: 运行 Layer 2 集成测试**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && npm run test:integration`
Expected: PASS。

- [ ] **Step 3: 编写 Layer 3 真实 OpenCode E2E 测试**

在 `tests/e2e/live-opencode.test.ts` 中：
- 检查 `OpenCode` 是否可用。
- 对临时复制的 MiniApp 下发真实任务：“在 ContentView 居中添加一个显示 'Counter: 0' 的 Text”。
- 运行真实 `StateMachine`。
- 验证 `xcodebuild` 编译成功，且文件产生实际改动。

- [ ] **Step 4: 运行全部测试套件**

Run: `export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && npm test`
Expected: 全部测试通过 (100% pass)。

- [ ] **Step 5: Commit**

```bash
git add tests/integration/ tests/e2e/
git commit -m "test: add integration fix-loop test and e2e live verification"
```
