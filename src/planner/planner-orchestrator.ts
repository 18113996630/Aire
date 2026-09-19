/**
 * AIRE Planner Orchestrator
 *
 * End-to-end coordinator bridging:
 * Input (Reference PNGs / PRD)
 *   ↓
 * AnalysisPipeline (Progressive Hydration)
 *   ↓
 * Analysis IR (.aire/analysis-ir.json)
 *   ↓
 * TaskGraphCompiler
 *   ↓
 * GraphValidator (6-Layer Deterministic Validation)
 *   ↓
 * Serialized task-graph.yaml
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import YAML from 'yaml';
import { AnalysisPipeline, type AnalysisPipelineOptions } from '../analysis/analysis-pipeline.ts';
import type { AnalysisIR } from '../analysis/types.ts';
import type { TaskGraphConfig } from '../dag/types.ts';
import { TaskGraphCompiler } from './task-graph-compiler.ts';
import type { TaskGraphCompilerOptions } from './types.ts';

export interface PlanExecuteOptions extends AnalysisPipelineOptions {
  outputPath?: string;
  compilerOptions?: TaskGraphCompilerOptions;
}

export interface PlanExecuteResult {
  ir: AnalysisIR;
  config: TaskGraphConfig;
  yamlContent: string;
  outputPath: string;
  irPath: string;
  specPaths: string[];
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export class PlannerOrchestrator {
  private pipeline: AnalysisPipeline;
  private compiler: TaskGraphCompiler;

  constructor(options?: {
    pipeline?: AnalysisPipeline;
    compiler?: TaskGraphCompiler;
  }) {
    this.pipeline = options?.pipeline ?? new AnalysisPipeline();
    this.compiler = options?.compiler ?? new TaskGraphCompiler();
  }

  /**
   * Run end-to-end plan generation.
   */
  async plan(options: PlanExecuteOptions): Promise<PlanExecuteResult> {
    // 1. Run Analysis Pipeline (Evidence -> Analysts -> IR)
    const pipelineResult = await this.pipeline.run(options);
    const ir = pipelineResult.ir;

    // 2. Compile IR to TaskGraphConfig with projectPath context
    const compiler = options.compilerOptions
      ? new TaskGraphCompiler({ projectPath: options.projectPath, ...options.compilerOptions })
      : new TaskGraphCompiler({ projectPath: options.projectPath });
    const config = compiler.compile(ir);

    // 3. Serialize to YAML
    const yamlContent = YAML.stringify(config);

    // 4. Write to outputPath atomically
    const outputPath = options.outputPath ?? path.join(options.projectPath, 'task-graph.yaml');
    await writeFileAtomic(outputPath, yamlContent);

    return {
      ir,
      config,
      yamlContent,
      outputPath,
      irPath: pipelineResult.irPath,
      specPaths: pipelineResult.exportedMarkdownFiles,
    };
  }
}
