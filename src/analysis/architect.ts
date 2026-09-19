/**
 * AIRE Software Architect Agent
 *
 * Defines SwiftUI MVVM architecture, SwiftData models, and strict file boundaries.
 * Integrates IAgentModel (Antigravity CLI) with semantic domain entity deduction.
 * Hydrates DataEntitySpec[] and ArchitectureContract into the Analysis IR.
 * Produces docs/architecture.md as a human-readable projection.
 */

import type {
  RawEvidence,
  ProductFlowSpec,
  RequirementSpec,
  ScreenSpec,
  DataEntitySpec,
  ArchitectureContract,
} from './types.ts';
import type { IAgentModel } from './agent-model.interface.ts';

export interface ArchitectAnalysisResult {
  entities: DataEntitySpec[];
  architecture: ArchitectureContract;
  markdownProjection: string;
}

export class Architect {
  private agentModel?: IAgentModel;

  constructor(options?: { agentModel?: IAgentModel }) {
    this.agentModel = options?.agentModel;
  }

  /**
   * Analyze flows, requirements, and screens to design SwiftUI MVVM + SwiftData architecture.
   */
  async analyze(
    appName: string,
    evidence: RawEvidence,
    flows: ProductFlowSpec[],
    requirements: RequirementSpec[],
    screens: ScreenSpec[]
  ): Promise<ArchitectAnalysisResult> {
    // 1. Attempt LLM-driven architecture design if agentModel is available
    if (this.agentModel) {
      try {
        const prompt = this.buildPrompt(appName, evidence, flows, requirements, screens);
        const result = await this.agentModel.generateStructured<{
          entities?: DataEntitySpec[];
        }>(prompt);

        if (result && Array.isArray(result.entities) && result.entities.length > 0) {
          const architecture = this.assembleArchitecture(appName, result.entities, screens);
          const markdownProjection = this.renderMarkdown(appName, result.entities, architecture);
          return {
            entities: result.entities,
            architecture,
            markdownProjection,
          };
        }
      } catch {
        // Fall back to heuristic domain deduction
      }
    }

    // 2. Semantic Domain Entity Deduction
    const entities = this.deduceDomainEntities(appName, evidence, requirements);
    const architecture = this.assembleArchitecture(appName, entities, screens);
    const markdownProjection = this.renderMarkdown(appName, entities, architecture);

    return {
      entities,
      architecture,
      markdownProjection,
    };
  }

  private deduceDomainEntities(
    appName: string,
    evidence: RawEvidence,
    requirements: RequirementSpec[]
  ): DataEntitySpec[] {
    const textCorpus = [
      appName,
      ...evidence.prdSections.map((s) => `${s.title} ${s.content}`),
      ...requirements.map((r) => `${r.title} ${r.acceptanceCriteria.join(' ')}`),
    ].join(' ').toLowerCase();

    // Timer / Pomodoro domain
    if (textCorpus.includes('timer') || textCorpus.includes('计时') || textCorpus.includes('番茄') || textCorpus.includes('pomodoro')) {
      return [
        {
          name: 'TimerSession',
          isSwiftDataModel: true,
          conformance: ['Identifiable', 'Codable'],
          fields: [
            { name: 'id', type: 'UUID', defaultValue: 'UUID()' },
            { name: 'title', type: 'String' },
            { name: 'durationSeconds', type: 'Int', defaultValue: '1500' },
            { name: 'remainingSeconds', type: 'Int', defaultValue: '1500' },
            { name: 'isCompleted', type: 'Bool', defaultValue: 'false' },
            { name: 'createdAt', type: 'Date', defaultValue: 'Date()' },
          ],
        },
      ];
    }

    // Expense / Accounting domain
    if (textCorpus.includes('expense') || textCorpus.includes('记账') || textCorpus.includes('账单') || textCorpus.includes('消费') || textCorpus.includes('transaction')) {
      return [
        {
          name: 'ExpenseRecord',
          isSwiftDataModel: true,
          conformance: ['Identifiable', 'Codable'],
          fields: [
            { name: 'id', type: 'UUID', defaultValue: 'UUID()' },
            { name: 'amount', type: 'Double', defaultValue: '0.0' },
            { name: 'category', type: 'String', defaultValue: '"General"' },
            { name: 'note', type: 'String', isOptional: true },
            { name: 'date', type: 'Date', defaultValue: 'Date()' },
          ],
        },
      ];
    }

    // Task / Todo domain
    if (textCorpus.includes('todo') || textCorpus.includes('task') || textCorpus.includes('待办') || textCorpus.includes('清单')) {
      return [
        {
          name: 'TodoTask',
          isSwiftDataModel: true,
          conformance: ['Identifiable', 'Codable'],
          fields: [
            { name: 'id', type: 'UUID', defaultValue: 'UUID()' },
            { name: 'title', type: 'String' },
            { name: 'isCompleted', type: 'Bool', defaultValue: 'false' },
            { name: 'dueDate', type: 'Date', isOptional: true },
            { name: 'createdAt', type: 'Date', defaultValue: 'Date()' },
          ],
        },
      ];
    }

    // General domain entity with domain-specific naming
    return [
      {
        name: `${appName}Item`,
        isSwiftDataModel: true,
        conformance: ['Identifiable', 'Codable'],
        fields: [
          { name: 'id', type: 'UUID', defaultValue: 'UUID()' },
          { name: 'title', type: 'String' },
          { name: 'subtitle', type: 'String', isOptional: true },
          { name: 'createdAt', type: 'Date', defaultValue: 'Date()' },
        ],
      },
    ];
  }

  private assembleArchitecture(
    appName: string,
    entities: DataEntitySpec[],
    screens: ScreenSpec[]
  ): ArchitectureContract {
    const modelFiles = entities.map((e) => `${appName}/Models/${e.name}.swift`);
    const viewModelFiles = [
      `${appName}/ViewModels/${appName}ViewModel.swift`,
    ];
    const viewFiles = screens.flatMap((s) =>
      s.components.map((c) => `${appName}/Views/${c.name}.swift`)
    );

    const fileBoundaries = [...modelFiles, ...viewModelFiles, ...viewFiles];

    return {
      pattern: 'MVVM',
      layers: {
        models: {
          directory: `${appName}/Models`,
          files: modelFiles,
        },
        viewModels: {
          directory: `${appName}/ViewModels`,
          files: viewModelFiles,
        },
        views: {
          directory: `${appName}/Views`,
          files: viewFiles,
        },
      },
      fileBoundaries,
    };
  }

  private buildPrompt(
    appName: string,
    evidence: RawEvidence,
    flows: ProductFlowSpec[],
    requirements: RequirementSpec[],
    screens: ScreenSpec[]
  ): string {
    return `You are the AIRE Software Architect Agent designing SwiftUI MVVM + SwiftData architecture.
App Name: ${appName}
Screens: ${screens.map((s) => s.title).join(', ')}
Requirements: ${requirements.map((r) => r.title).join('; ')}

Infer the proper domain data entities for this specific app (do not generate generic Item unless strictly necessary).
Return JSON matching schema:
{
  "entities": [
    {
      "name": "EntityName",
      "isSwiftDataModel": true,
      "conformance": ["Identifiable", "Codable"],
      "fields": [
        { "name": "id", "type": "UUID", "defaultValue": "UUID()" },
        { "name": "fieldName", "type": "String" }
      ]
    }
  ]
}`;
  }

  private renderMarkdown(
    appName: string,
    entities: DataEntitySpec[],
    architecture: ArchitectureContract
  ): string {
    const lines: string[] = [
      `# Architecture Specification: ${appName}`,
      '',
      `> Architecture Pattern: **${architecture.pattern}** with SwiftUI & SwiftData`,
      '',
      '## 1. Data Entities (Domain & Persistence)',
      '',
    ];

    for (const ent of entities) {
      lines.push(`### Entity: \`${ent.name}\` (${ent.isSwiftDataModel ? 'SwiftData @Model' : 'Standard Struct'})`);
      lines.push(`- Conformance: ${ent.conformance.map((c) => `\`${c}\``).join(', ')}`);
      lines.push('');
      lines.push('| Field Name | Type | Optional | Default Value |');
      lines.push('|---|---|---|---|');
      for (const f of ent.fields) {
        lines.push(`| \`${f.name}\` | \`${f.type}\` | ${f.isOptional ? 'Yes' : 'No'} | ${f.defaultValue ?? 'N/A'} |`);
      }
      lines.push('');
    }

    lines.push('## 2. Layered Responsibilities & File Boundaries');
    lines.push('');
    lines.push('### Allowed File Boundaries (`allowed_files` whitelist):');
    for (const f of architecture.fileBoundaries) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
    lines.push('### Layer Breakdown:');
    lines.push(`- **Models**: \`${architecture.layers.models.directory}\``);
    for (const f of architecture.layers.models.files) {
      lines.push(`  - \`${f}\``);
    }
    lines.push(`- **ViewModels**: \`${architecture.layers.viewModels.directory}\``);
    for (const f of architecture.layers.viewModels.files) {
      lines.push(`  - \`${f}\``);
    }
    lines.push(`- **Views**: \`${architecture.layers.views.directory}\``);
    for (const f of architecture.layers.views.files) {
      lines.push(`  - \`${f}\``);
    }
    lines.push('');

    return lines.join('\n');
  }
}
