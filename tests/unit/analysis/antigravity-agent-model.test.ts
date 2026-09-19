import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AntigravityAgentModel } from '../../../src/analysis/antigravity-agent-model.ts';
import { SmartHeuristicAgentModel } from '../../../src/analysis/heuristic-agent-model.ts';

describe('AntigravityAgentModel', () => {
  test('detects availability or non-availability gracefully', async () => {
    const invalidModel = new AntigravityAgentModel('/nonexistent/bin/agy');
    assert.equal(invalidModel.name, 'AntigravityAgentModel');
    const available = await invalidModel.isAvailable();
    assert.equal(available, false);
  });

  test('SmartHeuristicAgentModel provides offline fallback structured output', async () => {
    const model = new SmartHeuristicAgentModel();
    assert.equal(model.name, 'SmartHeuristicAgentModel');
    assert.equal(await model.isAvailable(), true);

    const productResult = await model.generateStructured<{ flows: any[]; requirements: any[] }>('ProductAnalyst prompt');
    assert.ok(Array.isArray(productResult.flows));
    assert.ok(Array.isArray(productResult.requirements));
  });
});
