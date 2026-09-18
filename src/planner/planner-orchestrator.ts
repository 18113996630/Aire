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

    // 2. Compile IR to TaskGraphConfig
    const compiler = options.compilerOptions
      ? new TaskGraphCompiler(options.compilerOptions)
      : this.compiler;
    const config = compiler.compile(ir);

    // 3. Serialize to YAML
    const yamlContent = YAML.stringify(config);

    // 4. Write to outputPath
    const outputPath = options.outputPath ?? path.join(options.projectPath, 'task-graph.yaml');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, yamlContent, 'utf-8');

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
