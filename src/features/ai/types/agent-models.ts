// Agent-specific model configurations

export interface AgentModelConfig {
  mode: "auto" | "manual";
  model?: string;
  previewEnabled?: boolean;
  reasoningEffort?: string;
}

export type ReasoningEffort = "low" | "medium" | "high" | "extra_high";

export interface ReasoningEffortOption {
  id: ReasoningEffort;
  name: string;
  description?: string;
  isDefault?: boolean;
  warning?: string;
}

export interface AgentModelOption {
  id: string;
  name: string;
  description?: string;
  isPreview?: boolean;
  isAuto?: boolean;
  reasoningEfforts?: ReasoningEffortOption[]; // Available reasoning levels for this model
  defaultReasoningEffort?: ReasoningEffort;
}

export interface AgentModelDefinition {
  agentId: string;
  settingsPath: string; // Relative to home directory
  settingsKey: string; // Key in settings JSON for model name
  reasoningKey?: string; // Key for reasoning effort setting
  previewKey?: string; // Key for preview features toggle
  autoModels: AgentModelOption[];
  manualModels: AgentModelOption[];
  previewModels?: AgentModelOption[]; // Additional models when preview is enabled
  defaultModel: string;
  defaultPreviewModel?: string;
}

// Common reasoning effort options
const FULL_REASONING_EFFORTS: ReasoningEffortOption[] = [
  { id: "low", name: "Low", description: "Fast responses with lighter reasoning" },
  {
    id: "medium",
    name: "Medium",
    description: "Balances speed and reasoning depth",
    isDefault: true,
  },
  { id: "high", name: "High", description: "Greater reasoning depth for complex problems" },
  {
    id: "extra_high",
    name: "Extra High",
    description: "Maximum reasoning depth",
    warning: "Can quickly consume rate limits",
  },
];

const MINI_REASONING_EFFORTS: ReasoningEffortOption[] = [
  {
    id: "medium",
    name: "Medium",
    description: "Dynamically adjusts reasoning based on task",
    isDefault: true,
  },
  { id: "high", name: "High", description: "Maximizes reasoning depth for complex problems" },
];

// Model definitions for each ACP agent
export const AGENT_MODEL_DEFINITIONS: Record<string, AgentModelDefinition> = {
  "gemini-cli": {
    agentId: "gemini-cli",
    settingsPath: ".gemini/settings.json",
    settingsKey: "model.name",
    previewKey: "general.previewFeatures",
    autoModels: [
      {
        id: "auto-gemini-2.5",
        name: "Auto (Gemini 2.5)",
        description: "Let CLI decide: gemini-2.5-pro, gemini-2.5-flash",
        isAuto: true,
      },
    ],
    manualModels: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    ],
    previewModels: [
      {
        id: "auto-gemini-3",
        name: "Auto (Gemini 3)",
        description: "Let CLI decide: gemini-3-pro, gemini-3-flash",
        isAuto: true,
        isPreview: true,
      },
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", isPreview: true },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", isPreview: true },
    ],
    defaultModel: "auto-gemini-2.5",
    defaultPreviewModel: "auto-gemini-3",
  },
  "claude-code": {
    agentId: "claude-code",
    settingsPath: ".claude/settings.json",
    settingsKey: "model",
    autoModels: [],
    manualModels: [
      { id: "claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    ],
    defaultModel: "claude-sonnet-4-5-20250514",
  },
  "codex-cli": {
    agentId: "codex-cli",
    settingsPath: ".codex/config.toml",
    settingsKey: "model",
    reasoningKey: "reasoning_effort",
    autoModels: [],
    manualModels: [
      {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        description: "Latest frontier agentic coding model",
        reasoningEfforts: FULL_REASONING_EFFORTS,
        defaultReasoningEffort: "medium",
      },
      {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        description: "Codex-optimized flagship for deep and fast reasoning",
        reasoningEfforts: FULL_REASONING_EFFORTS,
        defaultReasoningEffort: "medium",
      },
      {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        description: "Cheaper, faster, but less capable",
        reasoningEfforts: MINI_REASONING_EFFORTS,
        defaultReasoningEffort: "medium",
      },
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        description:
          "Latest frontier model with improvements across knowledge, reasoning and coding",
        reasoningEfforts: FULL_REASONING_EFFORTS,
        defaultReasoningEffort: "medium",
      },
    ],
    defaultModel: "gpt-5.2-codex",
  },
};

// Helper to get all available models for an agent
export function getAgentModels(agentId: string, previewEnabled = false): AgentModelOption[] {
  const definition = AGENT_MODEL_DEFINITIONS[agentId];
  if (!definition) return [];

  const models: AgentModelOption[] = [];

  // Add auto models
  models.push(...definition.autoModels);

  // Add preview auto models if preview is enabled
  if (previewEnabled && definition.previewModels) {
    const previewAutoModels = definition.previewModels.filter((m) => m.isAuto);
    models.push(...previewAutoModels);
  }

  // Add manual models
  models.push(...definition.manualModels);

  // Add preview manual models if preview is enabled
  if (previewEnabled && definition.previewModels) {
    const previewManualModels = definition.previewModels.filter((m) => !m.isAuto);
    models.push(...previewManualModels);
  }

  return models;
}

// Helper to check if an agent supports preview features
export function agentSupportsPreview(agentId: string): boolean {
  const definition = AGENT_MODEL_DEFINITIONS[agentId];
  return !!definition?.previewKey;
}

// Helper to get the default model for an agent
export function getDefaultModel(agentId: string, previewEnabled = false): string {
  const definition = AGENT_MODEL_DEFINITIONS[agentId];
  if (!definition) return "";

  if (previewEnabled && definition.defaultPreviewModel) {
    return definition.defaultPreviewModel;
  }
  return definition.defaultModel;
}

// Helper to check if an agent supports reasoning effort
export function agentSupportsReasoning(agentId: string): boolean {
  const definition = AGENT_MODEL_DEFINITIONS[agentId];
  return !!definition?.reasoningKey;
}

// Helper to get reasoning efforts for a specific model
export function getModelReasoningEfforts(
  agentId: string,
  modelId: string,
): ReasoningEffortOption[] | undefined {
  const models = getAgentModels(agentId, true);
  const model = models.find((m) => m.id === modelId);
  return model?.reasoningEfforts;
}

// Helper to get default reasoning effort for a model
export function getDefaultReasoningEffort(agentId: string, modelId: string): ReasoningEffort {
  const models = getAgentModels(agentId, true);
  const model = models.find((m) => m.id === modelId);
  return model?.defaultReasoningEffort || "medium";
}
