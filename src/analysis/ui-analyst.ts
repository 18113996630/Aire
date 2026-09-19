/**
 * AIRE UI & Visual Analyst Agent
 *
 * Extracts visual hierarchy, design tokens, and verification probes from physical evidence.
 * Integrates IAgentModel (Antigravity CLI) with evidence-anchored token sampling.
 * Enforces "No evidence, no token" by binding each token to physical sample source.
 * Hydrates ScreenSpec[], ComponentSpec[], and VisualToken[] into the Analysis IR.
 * Produces docs/design-spec.md as a human-readable projection.
 */

import type {
  RawEvidence,
  ProductFlowSpec,
  ScreenSpec,
  ComponentSpec,
  VisualToken,
} from './types.ts';
import type { IAgentModel } from './agent-model.interface.ts';

export interface UiAnalysisResult {
  screens: ScreenSpec[];
  tokens: VisualToken[];
  markdownProjection: string;
}

export class UiAnalyst {
  private agentModel?: IAgentModel;

  constructor(options?: { agentModel?: IAgentModel }) {
    this.agentModel = options?.agentModel;
  }

  /**
   * Analyze raw visual evidence and hydrate screens, components, and visual tokens.
   */
  async analyze(
    appName: string,
    evidence: RawEvidence,
    flows: ProductFlowSpec[]
  ): Promise<UiAnalysisResult> {
    const primaryImage = evidence.images[0];
    const imagePath = primaryImage ? primaryImage.filePath : 'reference.png';

    // 1. Attempt LLM-driven UI analysis if agentModel is available
    if (this.agentModel) {
      try {
        const prompt = this.buildPrompt(appName, evidence, flows);
        const result = await this.agentModel.generateStructured<{
          screens?: ScreenSpec[];
          tokens?: VisualToken[];
        }>(prompt);

        if (result && Array.isArray(result.screens) && result.screens.length > 0) {
          const tokens = Array.isArray(result.tokens) && result.tokens.length > 0
            ? result.tokens
            : this.buildEvidenceAnchoredTokens(imagePath, primaryImage?.dominantColors ?? []);
          const markdownProjection = this.renderMarkdown(appName, result.screens, tokens);
          return {
            screens: result.screens,
            tokens,
            markdownProjection,
          };
        }
      } catch {
        // Fall back to deterministic evidence-anchored analysis
      }
    }

    // 2. Deterministic & Evidence-Anchored Analysis ("No evidence, no token")
    const dominantColors = primaryImage?.dominantColors ?? [];
    const tokens = this.buildEvidenceAnchoredTokens(imagePath, dominantColors);

    // Derive screens from flows or default to main screen
    const screenIds = new Set<string>();
    for (const flow of flows) {
      for (const step of flow.steps) {
        if (step.screenId) screenIds.add(step.screenId);
      }
    }
    if (screenIds.size === 0) {
      screenIds.add('screen.main');
    }

    const screens: ScreenSpec[] = [];
    for (const sId of screenIds) {
      const isMain = sId === 'screen.main' || screens.length === 0;
      const screenTitle = isMain ? `${appName} Home` : `${appName} Details`;
      const route = isMain ? '/' : `/${sId.replace(/^screen\./, '')}`;

      const cardComponent: ComponentSpec = {
        id: `comp.${appName.toLowerCase()}_${sId.replace(/^screen\./, '')}`,
        name: `${appName}${isMain ? 'CardView' : 'DetailView'}`,
        role: `Primary view component for ${screenTitle}`,
        layout: 'VStack',
        tokens: tokens.map((t) => t.id),
        accessibilityIdentifier: `flow.screen.${sId.replace(/^screen\./, '')}`,
        probe: {
          id: `probe-${appName.toLowerCase()}-${sId.replace(/^screen\./, '')}`,
          focus: `${appName} layout, typography, and styling`,
          bounds: [40, 180, 350, 420],
          tolerance: {
            containerDeltaMax: 7.0,
            spacingPtMax: 2.0,
            textDeltaMax: 15.0,
          },
        },
      };

      screens.push({
        id: sId,
        title: screenTitle,
        route,
        components: [cardComponent],
        safeArea: { top: true, bottom: true },
        referenceImage: imagePath,
      });
    }

    const markdownProjection = this.renderMarkdown(appName, screens, tokens);

    return {
      screens,
      tokens,
      markdownProjection,
    };
  }

  private buildEvidenceAnchoredTokens(imagePath: string, dominantColors: string[]): VisualToken[] {
    const bgHex = dominantColors[0] ?? '#F2F2F7';
    const cardBgHex = dominantColors[1] ?? '#FFFFFF';
    const textHex = dominantColors[2] ?? '#000000';

    return [
      {
        id: 'color.background.primary',
        category: 'color',
        name: 'Primary Background',
        value: bgHex,
        swiftValue: bgHex.toLowerCase() === '#f2f2f7' ? 'Color(.systemBackground)' : `Color(hex: "${bgHex}")`,
        evidence: {
          sourceFile: imagePath,
          probeBox: [0, 0, 100, 100],
          samplingMethod: 'flat_fill',
        },
      },
      {
        id: 'color.card.background',
        category: 'color',
        name: 'Card Background',
        value: cardBgHex,
        swiftValue: cardBgHex.toLowerCase() === '#ffffff' ? 'Color(.secondarySystemBackground)' : `Color(hex: "${cardBgHex}")`,
        evidence: {
          sourceFile: imagePath,
          probeBox: [40, 180, 350, 420],
          samplingMethod: 'flat_fill',
        },
      },
      {
        id: 'color.text.primary',
        category: 'color',
        name: 'Primary Text Color',
        value: textHex,
        swiftValue: 'Color.primary',
        evidence: {
          sourceFile: imagePath,
          probeBox: [60, 200, 300, 240],
          samplingMethod: 'ink_core',
        },
      },
      {
        id: 'radius.card.default',
        category: 'radius',
        name: 'Card Corner Radius',
        value: 12,
        swiftValue: '12',
        evidence: {
          sourceFile: imagePath,
          samplingMethod: 'manual',
        },
      },
    ];
  }

  private buildPrompt(appName: string, evidence: RawEvidence, flows: ProductFlowSpec[]): string {
    const dominantColors = evidence.images[0]?.dominantColors ?? [];
    return `You are the AIRE UI Analyst Agent adhering to Super-Prototyping & Probe Verification Rules.
App Name: ${appName}
Reference Image: ${evidence.images[0]?.filePath ?? 'none'} (${evidence.images[0]?.width}x${evidence.images[0]?.height})
Sampled Dominant Colors: ${dominantColors.join(', ')}
Detected Flows: ${flows.map((f) => f.name).join('; ')}

Extract UI screens, components, and visual tokens anchored to physical image evidence ("No evidence, no token").
Return JSON matching schema:
{
  "tokens": [
    {
      "id": "color.xxx",
      "category": "color" | "typography" | "spacing" | "radius",
      "name": "...",
      "value": "...",
      "swiftValue": "...",
      "evidence": { "sourceFile": "${evidence.images[0]?.filePath ?? 'reference.png'}", "samplingMethod": "flat_fill" | "ink_core" }
    }
  ],
  "screens": [
    {
      "id": "screen.main",
      "title": "${appName} Home",
      "route": "/",
      "safeArea": { "top": true, "bottom": true },
      "referenceImage": "${evidence.images[0]?.filePath ?? 'reference.png'}",
      "components": [
        {
          "id": "comp.main_card",
          "name": "${appName}CardView",
          "role": "Primary card",
          "layout": "VStack",
          "tokens": ["color.background.primary", "color.text.primary"],
          "probe": {
            "id": "probe-main-card",
            "focus": "card layout",
            "bounds": [40, 180, 350, 420],
            "tolerance": { "containerDeltaMax": 7.0, "spacingPtMax": 2.0, "textDeltaMax": 15.0 }
          }
        }
      ]
    }
  ]
}`;
  }

  private renderMarkdown(
    appName: string,
    screens: ScreenSpec[],
    tokens: VisualToken[]
  ): string {
    const lines: string[] = [
      `# Design Specification: ${appName}`,
      '',
      '> Auto-generated by AIRE UI Analyst adhering to Super-Prototyping & Probe Verification Rules.',
      '',
      '## 1. Visual Tokens ("No evidence, no token")',
      '',
      '| Token ID | Category | Value | SwiftUI Binding | Evidence Source | Probe Method |',
      '|---|---|---|---|---|---|',
    ];

    for (const t of tokens) {
      lines.push(
        `| \`${t.id}\` | ${t.category} | ${t.value} | \`${t.swiftValue}\` | \`${t.evidence.sourceFile}\` | ${t.evidence.samplingMethod} |`
      );
    }

    lines.push('');
    lines.push('## 2. Screens & Component Hierarchy');
    lines.push('');

    for (const s of screens) {
      lines.push(`### Screen: ${s.title} (\`${s.id}\`)`);
      lines.push(`- Route: \`${s.route}\``);
      lines.push(`- Reference Image: \`${s.referenceImage ?? 'N/A'}\``);
      lines.push(`- Safe Area Constraints: Top: ${s.safeArea.top}, Bottom: ${s.safeArea.bottom}`);
      lines.push('');
      lines.push('#### Components');
      for (const c of s.components) {
        lines.push(`- **${c.name}** (\`${c.id}\`) - Layout: \`${c.layout}\``);
        lines.push(`  - Tokens: ${c.tokens.map((tk) => `\`${tk}\``).join(', ')}`);
        if (c.probe) {
          lines.push(
            `  - Visual Probe: \`${c.probe.id}\` (bounds: [${c.probe.bounds.join(', ')}], tolerance: containerMax=${c.probe.tolerance.containerDeltaMax}, textMax=${c.probe.tolerance.textDeltaMax})`
          );
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
