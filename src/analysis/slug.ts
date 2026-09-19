/**
 * AIRE Slug & Identifier Generator
 *
 * Handles arbitrary PRD titles (including Chinese, unicode, and special characters).
 * Generates clean, deterministic, collision-free identifiers for requirements and flows.
 */

import { createHash } from 'node:crypto';

export function slugify(text: string, prefix = 'item', index = 1): string {
  if (!text || typeof text !== 'string') {
    return `${prefix}.${String(index).padStart(3, '0')}`;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return `${prefix}.${String(index).padStart(3, '0')}`;
  }

  // Generate a short 4-char hash of the original text for collision resistance
  const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 4);

  // Extract ASCII alphanumeric words if available
  const asciiPart = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const indexStr = String(index).padStart(2, '0');

  if (asciiPart.length > 0) {
    return `${prefix}.${indexStr}_${asciiPart.slice(0, 30)}_${hash}`;
  }

  // For pure non-ASCII (e.g. Chinese characters like "首页", "设置"), use index + hash
  return `${prefix}.${indexStr}_${hash}`;
}
