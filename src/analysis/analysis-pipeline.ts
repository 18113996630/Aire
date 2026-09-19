/**
 * AIRE Multi-Agent Progressive Hydration Analysis Pipeline
 *
 * Coordinates EvidenceCollector -> ProductAnalyst -> UiAnalyst -> Architect:
 * 1. Collects deterministic physical evidence from screenshots and PRD.
 * 2. Enforces Reference Path Contract (.aire/evidence/images/) for 100% reliable execution.
 * 3. Progressively hydrates the Analysis IR across semantic layers using Antigravity Agent Model.
 * 4. Atomically persists machine truth (.aire/analysis-ir.json).
 * 5. Exports human-readable Markdown specs (docs/*.md).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AnalysisIR } from './types.ts';
import { EvidenceCollector } from './evidence-collector.ts';
import { ProductAnalyst } from './product-analyst.ts';
import { UiAnalyst } from './ui-analyst.ts';
import { Architect } from './architect.ts';
import type { IAgentModel } from './agent-model.interface.ts';
import { AntigravityAgentModel } from './antigravity-agent-model.ts';

export interface AnalysisPipelineOptions {
  appName: string;
  targetScheme?: string;
  projectPath: string;
  referenceDir?: string;
  referenceFile?: string;
  prdFile?: string;
  exportMarkdown?: boolean;
  agentModel?: IAgentModel;
}

export interface PipelineExecutionResult {
  ir: AnalysisIR;
  irPath: string;
  exportedMarkdownFiles: string[];
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filePath);
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
    agentModel?: IAgentModel;
  }) {
    const model = options?.agentModel;
    this.evidenceCollector = options?.evidenceCollector ?? new EvidenceCollector();
    this.productAnalyst = options?.productAnalyst ?? new ProductAnalyst(model ? { agentModel: model } : undefined);
    this.uiAnalyst = options?.uiAnalyst ?? new UiAnalyst(model ? { agentModel: model } : undefined);
    this.architect = options?.architect ?? new Architect(model ? { agentModel: model } : undefined);
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

    // 2. Reference Path Contract: Standardize image assets to .aire/evidence/images/
    const evidenceImgDir = path.join(options.projectPath, '.aire', 'evidence', 'images');
    await fs.mkdir(evidenceImgDir, { recursive: true });

    for (const img of rawEvidence.images) {
      if (img.filePath) {
        const baseName = path.basename(img.filePath);
        const targetImgPath = path.join(evidenceImgDir, baseName);
        if (path.resolve(img.filePath) !== path.resolve(targetImgPath)) {
          try {
            await fs.copyFile(img.filePath, targetImgPath);
          } catch {
            // Keep original if copy fails
          }
        }
        // Normalize image filePath to relative path from projectPath (e.g. .aire/evidence/images/home.png)
        img.filePath = path.relative(options.projectPath, targetImgPath) || `.aire/evidence/images/${baseName}`;
      }
    }

    // 3. Product Analyst Hydration
    const productResult = await this.productAnalyst.analyze(options.appName, rawEvidence);

    // 4. UI Analyst Hydration
    const uiResult = await this.uiAnalyst.analyze(options.appName, rawEvidence, productResult.flows);

    // 5. Software Architect Hydration
    const architectResult = await this.architect.analyze(
      options.appName,
      rawEvidence,
      productResult.flows,
      productResult.requirements,
      uiResult.screens
    );

    // 6. Assemble unified Analysis IR
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

    // 7. Atomically persist machine truth to .aire/analysis-ir.json
    const aireDir = path.join(options.projectPath, '.aire');
    await fs.mkdir(aireDir, { recursive: true });
    const irPath = path.join(aireDir, 'analysis-ir.json');
    await writeFileAtomic(irPath, JSON.stringify(ir, null, 2));

    // 8. Atomically export human-readable Markdown projections to docs/
    const exportedMarkdownFiles: string[] = [];
    if (options.exportMarkdown !== false) {
      const docsDir = path.join(options.projectPath, 'docs');
      await fs.mkdir(docsDir, { recursive: true });

      const productSpecPath = path.join(docsDir, 'product-spec.md');
      await writeFileAtomic(productSpecPath, productResult.markdownProjection);
      exportedMarkdownFiles.push(productSpecPath);

      const designSpecPath = path.join(docsDir, 'design-spec.md');
      await writeFileAtomic(designSpecPath, uiResult.markdownProjection);
      exportedMarkdownFiles.push(designSpecPath);

      const archSpecPath = path.join(docsDir, 'architecture.md');
      await writeFileAtomic(archSpecPath, architectResult.markdownProjection);
      exportedMarkdownFiles.push(archSpecPath);
    }

    return {
      ir,
      irPath,
      exportedMarkdownFiles,
    };
  }
}
