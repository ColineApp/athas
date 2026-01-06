import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ChevronDown, Sparkles, Zap } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import {
  AGENT_MODEL_DEFINITIONS,
  type AgentModelOption,
  agentSupportsPreview,
  agentSupportsReasoning,
  getAgentModels,
  getDefaultModel,
  getDefaultReasoningEffort,
  type ReasoningEffort,
  type ReasoningEffortOption,
} from "@/features/ai/types/agent-models";
import { cn } from "@/utils/cn";

interface AgentModelSelectorProps {
  className?: string;
}

interface AgentSettingsResponse {
  model: string | null;
  previewEnabled: boolean | null;
  reasoningEffort: string | null;
}

export const AgentModelSelector = memo(function AgentModelSelector({
  className,
}: AgentModelSelectorProps) {
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const agentId = getCurrentAgentId();

  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [isLoading, setIsLoading] = useState(true);

  const definition = AGENT_MODEL_DEFINITIONS[agentId];
  const supportsPreview = agentSupportsPreview(agentId);
  const supportsReasoning = agentSupportsReasoning(agentId);

  // Load current settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!definition) {
        setIsLoading(false);
        return;
      }

      try {
        const settings = await invoke<AgentSettingsResponse>("get_agent_settings", {
          agentId,
          settingsPath: definition.settingsPath,
          modelKey: definition.settingsKey,
          previewKey: definition.previewKey || null,
          reasoningKey: definition.reasoningKey || null,
        });

        const model = settings.model || getDefaultModel(agentId, settings.previewEnabled ?? false);
        setCurrentModel(model);
        setPreviewEnabled(settings.previewEnabled ?? false);
        setReasoningEffort(
          (settings.reasoningEffort as ReasoningEffort) ||
            getDefaultReasoningEffort(agentId, model),
        );
      } catch (error) {
        console.error("Failed to load agent settings:", error);
        setCurrentModel(getDefaultModel(agentId, false));
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [agentId, definition]);

  // Get available models
  const availableModels = useMemo(() => {
    return getAgentModels(agentId, previewEnabled);
  }, [agentId, previewEnabled]);

  // Get current model info
  const currentModelInfo = useMemo(() => {
    return availableModels.find((m) => m.id === currentModel) || null;
  }, [availableModels, currentModel]);

  // Handle model selection
  const handleSelectModel = useCallback(
    async (model: AgentModelOption) => {
      if (!definition) return;

      setCurrentModel(model.id);
      setIsModelOpen(false);

      // Set default reasoning effort for the new model
      const newReasoning = model.defaultReasoningEffort || "medium";
      setReasoningEffort(newReasoning);

      try {
        await invoke("set_agent_settings", {
          agentId,
          settingsPath: definition.settingsPath,
          modelKey: definition.settingsKey,
          previewKey: definition.previewKey || null,
          reasoningKey: definition.reasoningKey || null,
          model: model.id,
          previewEnabled: previewEnabled,
          reasoningEffort: model.reasoningEfforts ? newReasoning : null,
        });
      } catch (error) {
        console.error("Failed to save agent settings:", error);
      }
    },
    [agentId, definition, previewEnabled],
  );

  // Handle reasoning effort change
  const handleReasoningChange = useCallback(
    async (effort: ReasoningEffortOption) => {
      if (!definition || !supportsReasoning) return;

      setReasoningEffort(effort.id);

      try {
        await invoke("set_agent_settings", {
          agentId,
          settingsPath: definition.settingsPath,
          modelKey: definition.settingsKey,
          previewKey: definition.previewKey || null,
          reasoningKey: definition.reasoningKey || null,
          model: currentModel,
          previewEnabled: previewEnabled,
          reasoningEffort: effort.id,
        });
      } catch (error) {
        console.error("Failed to save reasoning settings:", error);
      }
    },
    [agentId, definition, currentModel, previewEnabled, supportsReasoning],
  );

  // Handle preview toggle
  const handleTogglePreview = useCallback(async () => {
    if (!definition || !supportsPreview) return;

    const newPreviewEnabled = !previewEnabled;
    setPreviewEnabled(newPreviewEnabled);

    // If switching preview mode, update to appropriate default model
    const newDefaultModel = getDefaultModel(agentId, newPreviewEnabled);
    setCurrentModel(newDefaultModel);

    try {
      await invoke("set_agent_settings", {
        agentId,
        settingsPath: definition.settingsPath,
        modelKey: definition.settingsKey,
        previewKey: definition.previewKey || null,
        reasoningKey: definition.reasoningKey || null,
        model: newDefaultModel,
        previewEnabled: newPreviewEnabled,
        reasoningEffort: null,
      });
    } catch (error) {
      console.error("Failed to save preview settings:", error);
    }
  }, [agentId, definition, previewEnabled, supportsPreview]);

  // Don't render if agent doesn't have model definitions
  if (!definition || availableModels.length === 0) {
    return null;
  }

  if (isLoading) {
    return (
      <div className={cn("flex h-7 items-center px-2 text-text-lighter text-xs", className)}>
        <span className="animate-pulse">...</span>
      </div>
    );
  }

  // Get current reasoning effort info
  const currentReasoningInfo = currentModelInfo?.reasoningEfforts?.find(
    (e) => e.id === reasoningEffort,
  );

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* Model selector dropdown */}
      <div className="relative">
        <button
          onClick={() => {
            setIsModelOpen(!isModelOpen);
            setIsReasoningOpen(false);
          }}
          className="flex h-7 items-center gap-1 rounded px-2 text-text-light text-xs transition-colors hover:bg-hover hover:text-text"
        >
          {previewEnabled && <Sparkles size={10} className="text-yellow-500" />}
          <span className="max-w-[100px] truncate">
            {currentModelInfo?.name || currentModel || "Model"}
          </span>
          <ChevronDown
            size={10}
            className={cn("transition-transform", isModelOpen && "rotate-180")}
          />
        </button>

        {isModelOpen && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setIsModelOpen(false)} />
            <div className="absolute right-0 bottom-full z-50 mb-1 w-[220px] rounded-lg border border-border bg-primary-bg py-1 shadow-xl">
              {/* Preview toggle for supported agents */}
              {supportsPreview && (
                <>
                  <button
                    onClick={handleTogglePreview}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-hover"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles
                        size={10}
                        className={previewEnabled ? "text-yellow-500" : "text-text-lighter"}
                      />
                      <span className="text-text">Preview Features</span>
                    </span>
                    <span
                      className={cn(
                        "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                        previewEnabled ? "bg-accent" : "bg-border",
                      )}
                    >
                      <span
                        className={cn(
                          "h-3 w-3 rounded-full bg-white transition-transform",
                          previewEnabled && "translate-x-3",
                        )}
                      />
                    </span>
                  </button>
                  <div className="mx-2 my-1 border-border border-t" />
                </>
              )}

              {/* Model list */}
              <div className="max-h-[200px] overflow-y-auto">
                {availableModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => handleSelectModel(model)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-hover",
                      currentModel === model.id && "bg-selected",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span
                          className={cn("text-text", currentModel === model.id && "font-medium")}
                        >
                          {model.name}
                        </span>
                        {model.isPreview && (
                          <span className="rounded bg-yellow-500/20 px-1 py-0.5 text-[9px] text-yellow-500">
                            Preview
                          </span>
                        )}
                      </div>
                      {model.description && (
                        <div className="mt-0.5 text-[10px] text-text-lighter">
                          {model.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Reasoning level dropdown - separate from model dropdown */}
      {supportsReasoning && currentModelInfo?.reasoningEfforts && (
        <div className="relative">
          <button
            onClick={() => {
              setIsReasoningOpen(!isReasoningOpen);
              setIsModelOpen(false);
            }}
            className="flex h-7 items-center gap-1 rounded px-2 text-text-light text-xs transition-colors hover:bg-hover hover:text-text"
          >
            <Zap size={10} className="text-accent" />
            <span className="max-w-[70px] truncate">{currentReasoningInfo?.name || "Medium"}</span>
            <ChevronDown
              size={10}
              className={cn("transition-transform", isReasoningOpen && "rotate-180")}
            />
          </button>

          {isReasoningOpen && (
            <>
              <div className="fixed inset-0 z-50" onClick={() => setIsReasoningOpen(false)} />
              <div className="absolute right-0 bottom-full z-50 mb-1 w-[200px] rounded-lg border border-border bg-primary-bg py-1 shadow-xl">
                <div className="px-3 py-1 text-[10px] text-text-lighter">Reasoning Level</div>
                {currentModelInfo.reasoningEfforts.map((effort) => (
                  <button
                    key={effort.id}
                    onClick={() => {
                      handleReasoningChange(effort);
                      setIsReasoningOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-hover",
                      reasoningEffort === effort.id && "bg-selected",
                    )}
                  >
                    <Zap
                      size={10}
                      className={cn(
                        "mt-0.5 shrink-0",
                        reasoningEffort === effort.id ? "text-accent" : "text-text-lighter",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "text-text",
                            reasoningEffort === effort.id && "font-medium",
                          )}
                        >
                          {effort.name}
                        </span>
                        {effort.isDefault && (
                          <span className="rounded bg-text-lighter/20 px-1 py-0.5 text-[9px] text-text-lighter">
                            default
                          </span>
                        )}
                      </div>
                      {effort.description && (
                        <div className="mt-0.5 text-[10px] text-text-lighter">
                          {effort.description}
                        </div>
                      )}
                      {effort.warning && (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-yellow-500">
                          <AlertTriangle size={8} />
                          <span>{effort.warning}</span>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});
