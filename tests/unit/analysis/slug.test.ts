import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../../../src/analysis/slug.ts';

describe('slugify', () => {
  test('slugifies standard english titles', () => {
    const slug1 = slugify('User Authentication Flow', 'req', 1);
    assert.match(slug1, /^req\.01_user_authentication_flow_[0-9a-f]{4}$/);

    const slug2 = slugify('Settings & Preferences', 'flow', 2);
    assert.match(slug2, /^flow\.02_settings_preferences_[0-9a-f]{4}$/);
  });

  test('handles pure Chinese PRD titles without collision', () => {
    const slugHome = slugify('首页展示与导航', 'req', 1);
    const slugSettings = slugify('设置页面', 'req', 2);
    const slugRecords = slugify('我的记录与流水', 'req', 3);

    assert.ok(slugHome.startsWith('req.01_'));
    assert.ok(slugSettings.startsWith('req.02_'));
    assert.ok(slugRecords.startsWith('req.03_'));

    // Verify all IDs are completely distinct
    const set = new Set([slugHome, slugSettings, slugRecords]);
    assert.equal(set.size, 3);
  });

  test('handles empty or malformed inputs gracefully', () => {
    const slugEmpty = slugify('', 'req', 5);
    assert.equal(slugEmpty, 'req.005');

    const slugNull = slugify(null as any, 'flow', 12);
    assert.equal(slugNull, 'flow.012');
  });
});
