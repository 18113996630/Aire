import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AnalysisIR,
  RawEvidence,
  VisualToken,
  ComponentSpec,
  ScreenSpec,
  DataEntitySpec,
  ArchitectureContract,
} from '../../../src/analysis/types.ts';

describe('Analysis IR & Evidence Model Schema', () => {
  test('validates complete AnalysisIR structure and token evidence anchor', () => {
    const rawEvidence: RawEvidence = {
      images: [
        {
          filePath: 'references/greeting.png',
          width: 1179,
          height: 2556,
          colorSpace: 'sRGB',
          dominantColors: ['#FFFFFF', '#F2F2F7', '#000000'],
        },
      ],
      prdSections: [
        {
          title: 'Greeting Card Flow',
          level: 1,
          content: 'User should see a greeting card with customizable title.',
          subsections: [],
        },
      ],
      collectedAt: new Date().toISOString(),
    };

    const token: VisualToken = {
      id: 'color.card.background',
      category: 'color',
      name: 'Card Background Fill',
      value: '#F2F2F7',
      swiftValue: 'Color(.secondarySystemBackground)',
      evidence: {
        sourceFile: 'references/greeting.png',
        probeBox: [60, 200, 330, 400],
        samplingMethod: 'flat_fill',
      },
    };

    const component: ComponentSpec = {
      id: 'comp.greeting_card',
      name: 'GreetingCardView',
      role: 'Reusable SwiftUI Card View',
      layout: 'VStack',
      tokens: [token.id],
      probe: {
        id: 'probe-greeting-card',
        focus: 'Greeting card background and padding',
        bounds: [60, 200, 330, 400],
        tolerance: {
          containerDeltaMax: 7.0,
          spacingPtMax: 2.0,
          textDeltaMax: 15.0,
        },
      },
    };

    const screen: ScreenSpec = {
      id: 'screen.main',
      title: 'Main Screen',
      route: '/main',
      components: [component],
      safeArea: { top: true, bottom: true },
      referenceImage: 'references/greeting.png',
    };

    const entity: DataEntitySpec = {
      name: 'Greeting',
      isSwiftDataModel: true,
      conformance: ['Identifiable', 'Codable'],
      fields: [
        { name: 'id', type: 'UUID', defaultValue: 'UUID()' },
        { name: 'title', type: 'String' },
        { name: 'message', type: 'String' },
      ],
    };

    const architecture: ArchitectureContract = {
      pattern: 'MVVM',
      layers: {
        models: { directory: 'MiniApp/Models', files: ['MiniApp/Models/Greeting.swift'] },
        viewModels: { directory: 'MiniApp/ViewModels', files: ['MiniApp/ViewModels/GreetingViewModel.swift'] },
        views: { directory: 'MiniApp/Views', files: ['MiniApp/Views/GreetingCardView.swift'] },
      },
      fileBoundaries: [
        'MiniApp/Models/Greeting.swift',
        'MiniApp/ViewModels/GreetingViewModel.swift',
        'MiniApp/Views/GreetingCardView.swift',
      ],
    };

    const ir: AnalysisIR = {
      version: '1.0.0',
      appName: 'MiniApp',
      targetScheme: 'MiniApp',
      evidence: rawEvidence,
      flows: [
        {
          id: 'flow.view_greeting',
          name: 'View Greeting',
          description: 'Launch app and view active greeting card',
          steps: [
            {
              stepNumber: 1,
              screenId: screen.id,
              action: 'App launch',
              expectedState: 'Greeting card rendered',
            },
          ],
        },
      ],
      requirements: [
        {
          id: 'req.greeting.render',
          title: 'Render Greeting Card',
          category: 'ui',
          acceptanceCriteria: ['Greeting card displays title and message'],
        },
      ],
      screens: [screen],
      tokens: [token],
      entities: [entity],
      architecture,
      createdAt: new Date().toISOString(),
    };

    assert.equal(ir.appName, 'MiniApp');
    assert.equal(ir.tokens[0].evidence.samplingMethod, 'flat_fill');
    assert.equal(ir.screens[0].components[0].tokens[0], 'color.card.background');
    assert.equal(ir.entities[0].name, 'Greeting');
    assert.equal(ir.architecture.fileBoundaries.length, 3);
  });
});
