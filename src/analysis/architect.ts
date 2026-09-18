/**
 * AIRE Software Architect Agent
 *
 * Defines SwiftUI MVVM architecture, SwiftData models, and strict file boundaries.
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

export interface ArchitectAnalysisResult {
  entities: DataEntitySpec[];
  architecture: ArchitectureContract;
  markdownProjection: string;
}

export class Architect {
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
    const entities: DataEntitySpec[] = [];

    // 1. Establish core entity
    const primaryEntity: DataEntitySpec = {
      name: `${appName}Item`,
      isSwiftDataModel: true,
      conformance: ['Identifiable', 'Codable'],
      fields: [
        { name: 'id', type: 'UUID', defaultValue: 'UUID()' },
        { name: 'title', type: 'String' },
        { name: 'subtitle', type: 'String', isOptional: true },
        { name: 'createdAt', type: 'Date', defaultValue: 'Date()' },
      ],
    };
    entities.push(primaryEntity);

    // 2. Establish MVVM layer boundaries and file contracts
    const modelFile = `${appName}/Models/${primaryEntity.name}.swift`;
    const viewModelFile = `${appName}/ViewModels/${appName}ViewModel.swift`;
    const viewFiles = screens.flatMap((s) =>
      s.components.map((c) => `${appName}/Views/${c.name}.swift`)
    );

    const fileBoundaries: string[] = [modelFile, viewModelFile, ...viewFiles];

    const architecture: ArchitectureContract = {
      pattern: 'MVVM',
      layers: {
        models: {
          directory: `${appName}/Models`,
          files: [modelFile],
        },
        viewModels: {
          directory: `${appName}/ViewModels`,
          files: [viewModelFile],
        },
        views: {
          directory: `${appName}/Views`,
          files: viewFiles,
        },
      },
      fileBoundaries,
    };

    const markdownProjection = this.renderMarkdown(appName, entities, architecture);

    return {
      entities,
      architecture,
      markdownProjection,
    };
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
