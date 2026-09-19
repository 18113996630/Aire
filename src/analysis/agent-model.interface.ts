/**
 * AIRE Agent Model Interface
 *
 * Provides a structured LLM inference interface for upstream analysts:
 * - ProductAnalyst
 * - UiAnalyst
 * - Architect
 */

export interface AgentModelOptions {
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface IAgentModel {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateStructured<T>(prompt: string, schema?: object, options?: AgentModelOptions): Promise<T>;
}
