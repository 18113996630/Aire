/**
 * AIRE Multi-Agent Progressive Hydration Analysis Pipeline
 *
 * Coordinates EvidenceCollector -> ProductAnalyst -> UiAnalyst -> Architect:
 * 1. Collects deterministic physical evidence from screenshots and PRD.
 * 2. Progressively hydrates the Analysis IR across semantic layers.
 * 3. Persists machine truth (.aire/analysis-ir.json).
 * 4. Exports human-readable Markdown specs (docs/*.md).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AnalysisIR } from './types.ts';
import { EvidenceCollector, type EvidenceCollectorOptions } from './evidence-collector.ts';
import { ProductAnalyst } from './product-analyst.ts';
import { UiAnalyst } from './ui-analyst.ts';
import { Architect } from './architect.ts';

export interface AnalysisPipelineOptions {
  appName: string;
  targetScheme?: string;
  projectPath: string;
  referenceDir?: string;
  referenceFile?: string;
  prdFile?: string;
  exportMarkdown?: boolean;
}

export interface PipelineExecutionResult {
  ir: AnalysisIR;
  irPath: string;
  exportedMarkdownFiles: string[];
}

export class AnalysisPipeline {
  private evidenceCollector: EvidenceCollector;
  private productAnalyst: ProductAnalyst;
  private uiAnalyst: UiAnalyst;
  private architect: Architect;

  constructor(options?: {
    evidenceCollector?: EvidenceCollector;
    productAnalyst?: ProductAnalyst;
    uiAnalyst?: UiAnalyst;
    architect?: Architect;
  }) {
    this.evidenceCollector = options?.evidenceCollector ?? new EvidenceCollector();
    this.productAnalyst = options?.productAnalyst ?? new ProductAnalyst();
    this.uiAnalyst = options?.uiAnalyst ?? new UiAnalyst();
    this.architect = options?.architect ?? new Architect();
  }

  /**
   * Run end-to-end progressive hydration analysis pipeline.
   */
  async run(options: AnalysisPipelineOptions): Promise<PipelineExecutionResult> {
    const targetScheme = options.targetScheme ?? options.appName;

    // 1. Deterministic Evidence Collection
    const rawEvidence = await this.evidenceCollector.collect({
      referenceDir: options.referenceDir,
      referenceFile: options.referenceFile,
      prdFile: options.prdFile,
    });

    // 2. Product Analyst Hydration
    const productResult = await this.productAnalyst.analyze(options.appName, rawEvidence);

    // 3. UI Analyst Hydration
    const uiResult = await this.uiAnalyst.analyze(options.appName, rawEvidence, productResult.flows);

    // 4. Software Architect Hydration
    const architectResult = await this.architect.analyze(
      options.appName,
      rawEvidence,
      productResult.flows,
      productResult.requirements,
      uiResult.screens
    );

    // 5. Assemble unified Analysis IR
    const ir: AnalysisIR = {
      version: '1.0.0',
      appName: options.appName,
      targetScheme,
      evidence: rawEvidence,
      flows: productResult.flows,
      requirements: productResult.requirements,
      screens: uiResult.screens,
      tokens: uiResult.tokens,
      entities: architectResult.entities,
      architecture: architectResult.architecture,
      createdAt: new Date().toISOString(),
    };

    // 6. Persist machine truth to .aire/analysis-ir.json
    const aireDir = path.join(options.projectPath, '.aire');
    await fs.mkdir(aireDir, { recursive: true });
    const irPath = path.join(aireDir, 'analysis-ir.json');
    await fs.writeFile(irPath, JSON.stringify(ir, null, 2), 'utf-8');

    // 7. Optionally export human-readable Markdown projections to docs/
    const exportedMarkdownFiles: string[] = [];
    if (options.exportMarkdown !== false) {
      const docsDir = path.join(options.projectPath, 'docs');
      await fs.mkdir(docsDir, { recursive: true });

      const productSpecPath = path.join(docsDir, 'product-spec.md');
      await fs.writeFile(productSpecPath, productResult.markdownProjection, 'utf-8');
      exportedMarkdownFiles.push(productSpecPath);

      const designSpecPath = path.join(docsDir, 'design-spec.md');
      await fs.writeFile(designSpecPath, uiResult.markdownProjection, 'utf-8');
      exportedMarkdownFiles.push(designSpecPath);

      const archSpecPath = path.join(docsDir, 'architecture.md');
      await fs.writeFile(archSpecPath, architectResult.markdownProjection, 'utf-8');
      exportedMarkdownFiles.push(archSpecPath);
    }

    return {
      ir,
      irPath,
      exportedMarkdownFiles,
    };
  }
}
