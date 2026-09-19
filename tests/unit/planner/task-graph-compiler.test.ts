import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { TaskGraphCompiler } from '../../../src/planner/task-graph-compiler.ts';
import { PlannerOrchestrator } from '../../../src/planner/planner-orchestrator.ts';
import { TaskGraph } from '../../../src/dag/task-graph.ts';
import type { AnalysisIR } from '../../../src/analysis/types.ts';

describe('TaskGraphCompiler & PlannerOrchestrator', () => {
  const sampleIR: AnalysisIR = {
    version: '1.0.0',
    appName: 'MiniApp',
    targetScheme: 'MiniApp',
    evidence: {
      images: [],
      prdSections: [],
      collectedAt: new Date().toISOString(),
    },
    flows: [
      {
        id: 'flow.main',
        name: 'Main Flow',
        description: 'Main flow',
        steps: [],
      },
    ],
    requirements: [
      {
        id: 'req.greeting',
        title: 'Greeting Card',
        category: 'ui',
        acceptanceCriteria: ['Greeting card displayed'],
      },
    ],
    screens: [
      {
        id: 'screen.main',
        title: 'Main Screen',
        route: '/',
        safeArea: { top: true, bottom: true },
        referenceImage: 'references/card.png',
        components: [
          {
            id: 'comp.card',
            name: 'GreetingCardView',
            role: 'Card View',
            layout: 'VStack',
            tokens: ['color.bg'],
            probe: {
              id: 'probe-card',
              focus: 'Greeting card layout',
              bounds: [40, 180, 350, 420],
              tolerance: {
                containerDeltaMax: 7.0,
                spacingPtMax: 2.0,
                textDeltaMax: 15.0,
              },
            },
          },
        ],
      },
    ],
    tokens: [
      {
        id: 'color.bg',
        category: 'color',
        name: 'Background',
        value: '#FFFFFF',
        swiftValue: 'Color.white',
        evidence: {
          sourceFile: 'references/card.png',
          samplingMethod: 'flat_fill',
        },
      },
    ],
    entities: [
      {
        name: 'Greeting',
        isSwiftDataModel: true,
        conformance: ['Identifiable', 'Codable'],
        fields: [
          { name: 'id', type: 'UUID' },
          { name: 'title', type: 'String' },
        ],
      },
    ],
    architecture: {
      pattern: 'MVVM',
      layers: {
        models: {
          directory: 'MiniApp/Models',
          files: ['MiniApp/Models/Greeting.swift'],
        },
        viewModels: {
          directory: 'MiniApp/ViewModels',
          files: ['MiniApp/ViewModels/GreetingViewModel.swift'],
        },
        views: {
          directory: 'MiniApp/Views',
          files: ['MiniApp/Views/GreetingCardView.swift'],
        },
      },
      fileBoundaries: [
        'MiniApp/Models/Greeting.swift',
        'MiniApp/ViewModels/GreetingViewModel.swift',
        'MiniApp/Views/GreetingCardView.swift',
      ],
    },
    createdAt: new Date().toISOString(),
  };

  test('compiles AnalysisIR into structurally valid TaskGraphConfig with proper DAG dependencies', () => {
    const compiler = new TaskGraphCompiler();
    const config = compiler.compile(sampleIR);

    assert.equal(config.project.name, 'MiniApp');
    assert.equal(config.tasks.length, 3); // 1 Model, 1 ViewModel, 1 View

    const modelTask = config.tasks.find((t) => t.id === 'task-data-greeting');
    const vmTask = config.tasks.find((t) => t.id === 'task-vm-greetingviewmodel');
    const viewTask = config.tasks.find((t) => t.id === 'task-view-greetingcardview');

    assert.ok(modelTask);
    assert.ok(vmTask);
    assert.ok(viewTask);

    assert.deepEqual(modelTask.dependencies, []);
    assert.deepEqual(vmTask.dependencies, ['task-data-greeting']);
    assert.deepEqual(viewTask.dependencies, ['task-vm-greetingviewmodel']);

    assert.ok(viewTask.verification.visual);
    assert.equal(viewTask.verification.visual?.reference, 'references/card.png');

    // Feed directly into TaskGraph to verify DAG cycle and index properties
    const taskGraph = new TaskGraph(config);
    assert.equal(taskGraph.getAllTasks().length, 3);
  });

  test('compiles multi-screen and flow requirements into navigation coordinator task with token constraints', () => {
    const multiScreenIR: AnalysisIR = {
      ...sampleIR,
      requirements: [
        { id: 'req.data.item', title: 'Data persistence', category: 'data', acceptanceCriteria: ['Save to SwiftData'] },
        { id: 'req.fn.toggle', title: 'Toggle feature', category: 'functional', acceptanceCriteria: ['Supports toggling status'] },
        { id: 'req.ui.card', title: 'Styled card', category: 'ui', acceptanceCriteria: ['Card padding 16pt'] },
        { id: 'req.nav.route', title: 'Navigation flow', category: 'navigation', acceptanceCriteria: ['Push detail view on tap'] },
      ],
      screens: [
        sampleIR.screens[0],
        {
          id: 'screen.detail',
          title: 'Detail Screen',
          route: '/detail',
          safeArea: { top: true, bottom: true },
          components: [
            {
              id: 'comp.detail',
              name: 'DetailCardView',
              role: 'Detail View',
              layout: 'VStack',
              tokens: ['color.bg'],
            },
          ],
        },
      ],
    };

    const compiler = new TaskGraphCompiler();
    const config = compiler.compile(multiScreenIR);

    // Expect: 1 Model + 1 ViewModel + 2 Views + 1 Navigation Coordinator = 5 tasks
    assert.equal(config.tasks.length, 5);

    const modelTask = config.tasks.find((t) => t.id === 'task-data-greeting');
    assert.ok(modelTask?.acceptance_criteria.includes('Save to SwiftData'));

    const vmTask = config.tasks.find((t) => t.id === 'task-vm-greetingviewmodel');
    assert.ok(vmTask?.acceptance_criteria.includes('Supports toggling status'));

    const viewTask = config.tasks.find((t) => t.id === 'task-view-greetingcardview');
    assert.ok(viewTask?.acceptance_criteria.some((c) => c.includes('Adheres strictly to tokens: color.bg')));
    assert.ok(viewTask?.acceptance_criteria.includes('Card padding 16pt'));

    const navTask = config.tasks.find((t) => t.id === 'task-nav-coordinator');
    assert.ok(navTask);
    assert.ok(navTask.dependencies.includes('task-view-greetingcardview'));
    assert.ok(navTask.dependencies.includes('task-view-detailcardview'));
    assert.ok(navTask.acceptance_criteria.includes('Push detail view on tap'));
  });

  test('PlannerOrchestrator runs end-to-end and creates task-graph.yaml and spec documents', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-orchestrator-'));
    const prdPath = path.join(tmpDir, 'prd.md');
    await fs.writeFile(
      prdPath,
      `# CardApp PRD\n## Core Feature\nUser sees greeting card.\n`,
      'utf-8'
    );

    const orchestrator = new PlannerOrchestrator();
    const result = await orchestrator.plan({
      appName: 'CardApp',
      projectPath: tmpDir,
      referenceFile: path.resolve('fixtures/MiniApp/reference.png'),
      prdFile: prdPath,
    });

    assert.ok(result.yamlContent);
    assert.ok(result.config.tasks.length > 0);

    const yamlExists = await fs.stat(result.outputPath).then(() => true).catch(() => false);
    assert.ok(yamlExists);

    const savedYaml = await fs.readFile(result.outputPath, 'utf-8');
    const parsedGraph = TaskGraph.fromYaml(savedYaml);
    assert.equal(parsedGraph.project?.name, 'CardApp');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
