/**
 * AIRE Product Analyst Agent
 *
 * Extracts product flows and requirement specifications from raw evidence.
 * Integrates IAgentModel (Antigravity CLI) with intelligent heuristic fallback.
 * Hydrates ProductFlowSpec[] and RequirementSpec[] into the Analysis IR.
 * Produces docs/product-spec.md as a human-readable projection.
 */

import type {
  RawEvidence,
  ProductFlowSpec,
  RequirementSpec,
  PrdSectionEvidence,
} from './types.ts';
import type { IAgentModel } from './agent-model.interface.ts';
import { slugify } from './slug.ts';

export interface ProductAnalysisResult {
  flows: ProductFlowSpec[];
  requirements: RequirementSpec[];
  markdownProjection: string;
}

export class ProductAnalyst {
  private agentModel?: IAgentModel;

  constructor(options?: { agentModel?: IAgentModel }) {
    this.agentModel = options?.agentModel;
  }

  /**
   * Analyze raw evidence and hydrate product flows and requirements.
   */
  async analyze(appName: string, evidence: RawEvidence): Promise<ProductAnalysisResult> {
    // 1. Attempt LLM-driven inference if agentModel is available
    if (this.agentModel) {
      try {
        const prompt = this.buildPrompt(appName, evidence);
        const result = await this.agentModel.generateStructured<{
          flows?: ProductFlowSpec[];
          requirements?: RequirementSpec[];
        }>(prompt);

        if (result && Array.isArray(result.requirements) && result.requirements.length > 0) {
          const flows = Array.isArray(result.flows) && result.flows.length > 0
            ? result.flows
            : this.deriveFallbackFlows(appName, evidence);
          const markdownProjection = this.renderMarkdown(appName, flows, result.requirements);
          return {
            flows,
            requirements: result.requirements,
            markdownProjection,
          };
        }
      } catch {
        // Fall back to deterministic heuristic analysis
      }
    }

    // 2. Deterministic & Heuristic Analysis with collision-free slugification
    const flows: ProductFlowSpec[] = [];
    const requirements: RequirementSpec[] = [];

    if (evidence.prdSections.length > 0) {
      let reqIndex = 1;
      let flowIndex = 1;

      for (const section of evidence.prdSections) {
        requirements.push({
          id: slugify(section.title, 'req', reqIndex++),
          title: section.title,
          category: 'functional',
          acceptanceCriteria: section.content
            ? section.content.split('\n').filter((l) => l.trim().length > 0).slice(0, 3)
            : [`Fulfill ${section.title} requirements`],
        });

        for (const sub of section.subsections) {
          flows.push({
            id: slugify(sub.title, 'flow', flowIndex++),
            name: sub.title,
            description: sub.content.trim() || `User flow for ${sub.title}`,
            steps: [
              {
                stepNumber: 1,
                screenId: 'screen.main',
                action: 'Navigate to view',
                expectedState: `${sub.title} visible`,
              },
            ],
          });
        }
      }
    }

    // If no flows or requirements derived from PRD, deduce from images
    if (flows.length === 0) {
      flows.push(...this.deriveFallbackFlows(appName, evidence));
    }

    if (requirements.length === 0) {
      requirements.push({
        id: slugify(`${appName} Core Experience`, 'req', 1),
        title: `${appName} Core View & Model`,
        category: 'ui',
        acceptanceCriteria: [
          'App launches cleanly without runtime exceptions',
          'Primary UI elements match design specifications',
        ],
      });
    }

    const markdownProjection = this.renderMarkdown(appName, flows, requirements);

    return {
      flows,
      requirements,
      markdownProjection,
    };
  }

  private deriveFallbackFlows(appName: string, evidence: RawEvidence): ProductFlowSpec[] {
    const ocrSummary = evidence.images[0]?.ocrTextBlocks?.map((b) => b.text).join(', ');
    const desc = ocrSummary
      ? `Render ${appName} with detected elements: ${ocrSummary}`
      : `Launch ${appName} and render primary experience`;

    return [
      {
        id: 'flow.01_main_view',
        name: `Launch ${appName}`,
        description: desc,
        steps: [
          {
            stepNumber: 1,
            screenId: 'screen.main',
            action: 'Launch application',
            expectedState: 'Primary screen rendered cleanly',
          },
        ],
      },
    ];
  }

  private buildPrompt(appName: string, evidence: RawEvidence): string {
    const prdText = evidence.prdSections
      .map((s) => `## ${s.title}\n${s.content}\n` + s.subsections.map((sub) => `### ${sub.title}\n${sub.content}`).join('\n'))
      .join('\n\n');

    const imageSummary = evidence.images.map((img, i) =>
      `Image ${i + 1}: ${img.filePath} (${img.width}x${img.height}, ${img.colorSpace}), dominant colors: ${img.dominantColors.join(', ')}`
    ).join('\n');

    return `You are the AIRE Product Analyst Agent.
App Name: ${appName}
Physical Evidence:
${imageSummary}

PRD Specifications:
${prdText || '(No explicit PRD provided, infer from app name and images)'}

Analyze the requirements and user flows. Return a JSON object matching this schema:
{
  "flows": [
    {
      "id": "flow.xxx",
      "name": "Flow Name",
      "description": "Flow description",
      "steps": [
        { "stepNumber": 1, "screenId": "screen.xxx", "action": "...", "expectedState": "..." }
      ]
    }
  ],
  "requirements": [
    {
      "id": "req.xxx",
      "title": "Requirement Title",
      "category": "functional" | "ui" | "data" | "navigation",
      "acceptanceCriteria": ["criterion 1", "criterion 2"]
    }
  ]
}`;
  }

  private renderMarkdown(
    appName: string,
    flows: ProductFlowSpec[],
    requirements: RequirementSpec[]
  ): string {
    const lines: string[] = [
      `# Product Specification: ${appName}`,
      '',
      '> Auto-generated by AIRE Product Analyst from Physical Evidence & PRD.',
      '',
      '## 1. Product Flows',
      '',
    ];

    for (const flow of flows) {
      lines.push(`### ${flow.name} (\`${flow.id}\`)`);
      lines.push(`${flow.description}`);
      lines.push('');
      lines.push('| Step | Screen | Action | Expected State |');
      lines.push('|---|---|---|---|');
      for (const s of flow.steps) {
        lines.push(`| ${s.stepNumber} | \`${s.screenId}\` | ${s.action} | ${s.expectedState} |`);
      }
      lines.push('');
    }

    lines.push('## 2. Requirements Matrix');
    lines.push('');
    for (const req of requirements) {
      lines.push(`### ${req.title} (\`${req.id}\`) - [${req.category.toUpperCase()}]`);
      for (const crit of req.acceptanceCriteria) {
        lines.push(`- [ ] ${crit}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
