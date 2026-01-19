import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Check,
  CheckCircle,
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAutocompleteKeyStore } from "@/features/ai/store/autocomplete-key-store";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig, SessionMode } from "@/features/ai/types/acp";
import { getAvailableProviders, updateAgentStatus } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";
import Slider from "@/ui/slider";
import Switch from "@/ui/switch";
import { cn } from "@/utils/cn";
import "@/utils/autocomplete-provider-registry";
import { getAutocompleteProviders } from "@/utils/autocomplete-providers";
import { getProvider } from "@/utils/providers";

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  // State for available session modes
  const [availableModes, setAvailableModes] = useState<SessionMode[]>([]);
  const [isClearingChats, setIsClearingChats] = useState(false);

  // Detect installed agents on mount
  useEffect(() => {
    const detectAgents = async () => {
      try {
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        updateAgentStatus(availableAgents.map((a) => ({ id: a.id, installed: a.installed })));
      } catch {
        // Failed to detect agents, leave as not installed
      }
    };
    detectAgents();
  }, []);

  // Get available session modes from AI chat store
  useEffect(() => {
    const unsubscribe = useAIChatStore.subscribe((state) => {
      setAvailableModes(state.sessionModeState.availableModes);
    });
    // Initialize with current value
    setAvailableModes(useAIChatStore.getState().sessionModeState.availableModes);
    return unsubscribe;
  }, []);

  // State for inline API key editing
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<{
    providerId: string | null;
    status: "valid" | "invalid" | null;
    message?: string;
  }>({ providerId: null, status: null });

  // Autocomplete provider/key state
  const autocompleteProviders = getAutocompleteProviders();
  const currentAutocompleteProvider =
    autocompleteProviders.find((p) => p.id === settings.aiAutocompleteProviderId) ||
    autocompleteProviders[0];
  const autocompleteKeyMap = useAutocompleteKeyStore.use.providerKeys();
  const {
    checkKey: checkAutocompleteKey,
    saveKey: saveAutocompleteKey,
    removeKey: removeAutocompleteKey,
  } = useAutocompleteKeyStore.use.actions();
  const [editingAutocompleteKey, setEditingAutocompleteKey] = useState(false);
  const [autocompleteKeyInput, setAutocompleteKeyInput] = useState("");
  const [showAutocompleteKey, setShowAutocompleteKey] = useState(false);
  const [isValidatingAutocomplete, setIsValidatingAutocomplete] = useState(false);
  const [autocompleteValidationStatus, setAutocompleteValidationStatus] = useState<{
    status: "valid" | "invalid" | null;
    message?: string;
  }>({ status: null });

  // Dynamic models state
  const { dynamicModels, setDynamicModels } = useAIChatStore();
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  // API Key functions from AI chat store
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);

  // Check all provider API keys on mount
  useEffect(() => {
    checkAllProviderApiKeys();
  }, [checkAllProviderApiKeys]);

  useEffect(() => {
    if (!currentAutocompleteProvider && autocompleteProviders.length > 0) {
      updateSetting("aiAutocompleteProviderId", autocompleteProviders[0].id);
    }
  }, [autocompleteProviders, currentAutocompleteProvider, updateSetting]);

  useEffect(() => {
    if (!currentAutocompleteProvider) return;
    checkAutocompleteKey(currentAutocompleteProvider.id);
  }, [currentAutocompleteProvider?.id, checkAutocompleteKey]);

  const providers = getAvailableProviders();
  const currentProvider = providers.find((p) => p.id === settings.aiProviderId);

  // Fetch dynamic models if provider supports it
  const fetchDynamicModels = async () => {
    const providerInstance = getProvider(settings.aiProviderId);
    const providerConfig = providers.find((p) => p.id === settings.aiProviderId);

    // Always clear error when fetching/switching
    setModelFetchError(null);

    // Only fetch dynamic models if provider supports it AND does not require an API key (unless explicitly allowed)
    // This enforces static lists for cloud providers like OpenAI as requested
    if (providerInstance?.getModels && !providerConfig?.requiresApiKey) {
      setIsLoadingModels(true);
      try {
        const models = await providerInstance.getModels();
        if (models.length > 0) {
          setDynamicModels(settings.aiProviderId, models);
          // If current model is not in the list, select the first one
          if (!models.find((m) => m.id === settings.aiModelId)) {
            updateSetting("aiModelId", models[0].id);
          }
        } else {
          setDynamicModels(settings.aiProviderId, []);
          const errorMessage =
            settings.aiProviderId === "ollama"
              ? "No models detected. Please install a model in Ollama."
              : "No models found.";
          setModelFetchError(errorMessage);
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
        setModelFetchError("Failed to fetch models");
      } finally {
        setIsLoadingModels(false);
      }
    }
  };

  useEffect(() => {
    fetchDynamicModels();
  }, [settings.aiProviderId, updateSetting, setDynamicModels]);

  const providerOptions = getAvailableProviders().map((provider) => ({
    value: provider.id,
    label: provider.name,
  }));

  const autocompleteProviderOptions = autocompleteProviders.map((provider) => ({
    value: provider.id,
    label: provider.name,
  }));

  const hasAutocompleteKey =
    currentAutocompleteProvider?.requiresApiKey === false
      ? true
      : !!(currentAutocompleteProvider && autocompleteKeyMap.get(currentAutocompleteProvider.id));

  const canEnableAutocomplete = !!currentAutocompleteProvider && hasAutocompleteKey;

  const handleProviderChange = (providerId: string) => {
    const provider = getAvailableProviders().find((p) => p.id === providerId);
    if (provider) {
      updateSetting("aiProviderId", providerId);
      // Reset model ID, it will be updated by fetchDynamicModels or default logic
      if (provider.models.length > 0) {
        updateSetting("aiModelId", provider.models[0].id);
      }
    }
  };

  const handleAutocompleteProviderChange = (providerId: string) => {
    updateSetting("aiAutocompleteProviderId", providerId);
  };
  const startEditing = (providerId: string) => {
    setEditingProvider(providerId);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
  };

  const handleSaveKey = async (providerId: string) => {
    if (!apiKeyInput.trim()) {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Please enter an API key",
      });
      return;
    }

    setIsValidating(true);
    setValidationStatus({ providerId: null, status: null });

    try {
      const isValid = await saveApiKey(providerId, apiKeyInput);

      if (isValid) {
        setValidationStatus({
          providerId,
          status: "valid",
          message: "API key saved successfully",
        });
        setTimeout(() => {
          cancelEditing();
        }, 1500);
      } else {
        setValidationStatus({
          providerId,
          status: "invalid",
          message: "Invalid API key. Please check and try again.",
        });
      }
    } catch {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Failed to validate API key",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    try {
      await removeApiKey(providerId);
      setValidationStatus({
        providerId,
        status: "valid",
        message: "API key removed",
      });
      setTimeout(() => {
        setValidationStatus({ providerId: null, status: null });
      }, 2000);
    } catch {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Failed to remove API key",
      });
    }
  };

  const startEditingAutocompleteKey = () => {
    setEditingAutocompleteKey(true);
    setAutocompleteKeyInput("");
    setShowAutocompleteKey(false);
    setAutocompleteValidationStatus({ status: null });
  };

  const cancelEditingAutocompleteKey = () => {
    setEditingAutocompleteKey(false);
    setAutocompleteKeyInput("");
    setShowAutocompleteKey(false);
    setAutocompleteValidationStatus({ status: null });
  };

  const handleSaveAutocompleteKey = async () => {
    if (!currentAutocompleteProvider) return;
    if (!autocompleteKeyInput.trim()) {
      setAutocompleteValidationStatus({
        status: "invalid",
        message: "Please enter an API key",
      });
      return;
    }

    setIsValidatingAutocomplete(true);
    setAutocompleteValidationStatus({ status: null });

    try {
      const isValid = await saveAutocompleteKey(
        currentAutocompleteProvider.id,
        autocompleteKeyInput,
      );
      if (isValid) {
        setAutocompleteValidationStatus({
          status: "valid",
          message: "API key saved successfully",
        });
        setTimeout(() => {
          cancelEditingAutocompleteKey();
        }, 1500);
      } else {
        setAutocompleteValidationStatus({
          status: "invalid",
          message: "Invalid API key. Please check and try again.",
        });
      }
    } catch {
      setAutocompleteValidationStatus({
        status: "invalid",
        message: "Failed to validate API key",
      });
    } finally {
      setIsValidatingAutocomplete(false);
    }
  };

  const handleRemoveAutocompleteKey = async () => {
    if (!currentAutocompleteProvider) return;
    try {
      await removeAutocompleteKey(currentAutocompleteProvider.id);
      setAutocompleteValidationStatus({
        status: "valid",
        message: "API key removed",
      });
      setTimeout(() => {
        setAutocompleteValidationStatus({ status: null });
      }, 2000);
    } catch {
      setAutocompleteValidationStatus({
        status: "invalid",
        message: "Failed to remove API key",
      });
    }
  };

  const renderApiKeyInput = (providerId: string, providerName: string) => {
    const isEditing = editingProvider === providerId;
    const hasKey = hasProviderApiKey(providerId);
    const showingValidation = validationStatus.providerId === providerId && validationStatus.status;

    if (!isEditing && !hasKey && !showingValidation) {
      return (
        <Button
          variant="outline"
          size="xs"
          onClick={() => startEditing(providerId)}
          className="gap-1.5"
        >
          <Key size={12} />
          Set API Key
        </Button>
      );
    }

    if (!isEditing && hasKey) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-green-500 text-xs">
            <Check size={12} />
            <span>Configured</span>
          </div>
          <Button variant="ghost" size="xs" onClick={() => startEditing(providerId)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => handleRemoveKey(providerId)}
            className="text-red-500 hover:bg-red-500/10"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      );
    }

    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`Enter ${providerName} API key...`}
              className={cn(
                "ui-font w-full rounded border bg-secondary-bg px-2 py-1.5 pr-8 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
                showingValidation && validationStatus.status === "invalid"
                  ? "border-red-500"
                  : "border-border",
              )}
              disabled={isValidating}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="-translate-y-1/2 absolute top-1/2 right-2 text-text-lighter transition-colors hover:text-text"
            >
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <Button
            variant="default"
            size="xs"
            onClick={() => handleSaveKey(providerId)}
            disabled={!apiKeyInput.trim() || isValidating}
          >
            {isValidating ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" size="xs" onClick={cancelEditing}>
            <X size={12} />
          </Button>
        </div>

        {showingValidation && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              validationStatus.status === "valid" ? "text-green-500" : "text-red-500",
            )}
          >
            {validationStatus.status === "valid" ? (
              <CheckCircle size={12} />
            ) : (
              <AlertCircle size={12} />
            )}
            <span>{validationStatus.message}</span>
          </div>
        )}
      </div>
    );
  };

  const renderAutocompleteKeyInput = () => {
    if (!currentAutocompleteProvider) return null;
    const hasKey = currentAutocompleteProvider.requiresApiKey
      ? autocompleteKeyMap.get(currentAutocompleteProvider.id) || false
      : true;
    const showingValidation = autocompleteValidationStatus.status !== null;

    if (!editingAutocompleteKey && !hasKey && !showingValidation) {
      return (
        <Button
          variant="outline"
          size="xs"
          onClick={startEditingAutocompleteKey}
          className="gap-1.5"
        >
          <Key size={12} />
          Set API Key
        </Button>
      );
    }

    if (!editingAutocompleteKey && hasKey) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-green-500 text-xs">
            <Check size={12} />
            <span>Configured</span>
          </div>
          <Button variant="ghost" size="xs" onClick={startEditingAutocompleteKey}>
            Edit
          </Button>
          {currentAutocompleteProvider.requiresApiKey && (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleRemoveAutocompleteKey}
              className="text-red-500 hover:bg-red-500/10"
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showAutocompleteKey ? "text" : "password"}
              value={autocompleteKeyInput}
              onChange={(e) => setAutocompleteKeyInput(e.target.value)}
              placeholder={`Enter ${currentAutocompleteProvider.name} API key...`}
              className={cn(
                "ui-font w-full rounded border bg-secondary-bg px-2 py-1.5 pr-8 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
                showingValidation && autocompleteValidationStatus.status === "invalid"
                  ? "border-red-500"
                  : "border-border",
              )}
              disabled={isValidatingAutocomplete}
            />
            <button
              type="button"
              onClick={() => setShowAutocompleteKey(!showAutocompleteKey)}
              className="-translate-y-1/2 absolute top-1/2 right-2 text-text-lighter transition-colors hover:text-text"
            >
              {showAutocompleteKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <Button
            variant="default"
            size="xs"
            onClick={handleSaveAutocompleteKey}
            disabled={!autocompleteKeyInput.trim() || isValidatingAutocomplete}
          >
            {isValidatingAutocomplete ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" size="xs" onClick={cancelEditingAutocompleteKey}>
            <X size={12} />
          </Button>
        </div>

        {showingValidation && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              autocompleteValidationStatus.status === "valid" ? "text-green-500" : "text-red-500",
            )}
          >
            {autocompleteValidationStatus.status === "valid" ? (
              <CheckCircle size={12} />
            ) : (
              <AlertCircle size={12} />
            )}
            <span>{autocompleteValidationStatus.message}</span>
          </div>
        )}
      </div>
    );
  };

  // Get all providers that require API keys
  const providersNeedingKeys = getAvailableProviders().filter((p) => p.requiresApiKey);

  // Get all providers that require authentication (but not API keys)
  const providersNeedingAuth = getAvailableProviders().filter(
    (p) => p.requiresAuth && !p.requiresApiKey,
  );

  const providerInstance = getProvider(settings.aiProviderId);
  const supportsDynamicModels = !!providerInstance?.getModels;

  return (
    <div className="space-y-4">
      <Section title="Provider & Model">
        <SettingRow label="Provider" description="Choose your AI service provider">
          <Dropdown
            value={settings.aiProviderId}
            options={providerOptions}
            onChange={handleProviderChange}
            size="xs"
            searchable={true}
          />
        </SettingRow>

        <SettingRow label="Model" description="Select the AI model to use">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <select
                value={settings.aiModelId}
                onChange={(e) => updateSetting("aiModelId", e.target.value)}
                className="flex-1 rounded-md border border-border bg-secondary-bg px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
              >
                {(dynamicModels[settings.aiProviderId] || currentProvider?.models || []).map(
                  (model: any) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ),
                )}
              </select>
            </div>
            {supportsDynamicModels && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => fetchDynamicModels()}
                disabled={isLoadingModels}
                title="Refresh models"
              >
                <RefreshCw size={14} className={cn(isLoadingModels && "animate-spin")} />
              </Button>
            )}
          </div>
          {modelFetchError && (
            <div className="mt-1 flex items-center gap-1.5 text-red-500 text-xs">
              <AlertCircle size={12} />
              <span>{modelFetchError}</span>
            </div>
          )}
        </SettingRow>
      </Section>

      {providersNeedingKeys.length > 0 && (
        <Section title="API Keys">
          {providersNeedingKeys.map((provider) => (
            <SettingRow key={provider.id} label={provider.name}>
              {renderApiKeyInput(provider.id, provider.name)}
            </SettingRow>
          ))}
        </Section>
      )}

      {providersNeedingAuth.length > 0 && (
        <Section title="Authentication">
          {providersNeedingAuth.map((provider) => (
            <SettingRow
              key={provider.id}
              label={provider.name}
              description="Requires OAuth authentication"
            >
              <div className="flex items-center gap-2 rounded border border-border bg-secondary-bg px-3 py-1.5">
                <span className="text-text-lighter text-xs">Coming Soon</span>
              </div>
            </SettingRow>
          ))}
        </Section>
      )}

      <Section title="Model Parameters">
        <SettingRow
          label="Temperature"
          description="Controls randomness in responses (0 = deterministic, 2 = creative)"
        >
          <Slider
            value={settings.aiTemperature}
            min={0}
            max={2}
            step={0.1}
            onChange={(value) => updateSetting("aiTemperature", value)}
            valueFormatter={(v) => v.toFixed(1)}
          />
        </SettingRow>

        <SettingRow label="Max Tokens" description="Maximum length of AI responses">
          <Dropdown
            value={settings.aiMaxTokens.toString()}
            options={[
              { value: "1024", label: "1,024" },
              { value: "2048", label: "2,048" },
              { value: "4096", label: "4,096" },
              { value: "8192", label: "8,192" },
              { value: "16384", label: "16,384" },
            ]}
            onChange={(value) => updateSetting("aiMaxTokens", parseInt(value))}
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Defaults">
        <SettingRow
          label="Default Output Style"
          description="Default verbosity level for AI responses"
        >
          <Dropdown
            value={settings.aiDefaultOutputStyle}
            options={[
              { value: "default", label: "Default" },
              { value: "explanatory", label: "Explanatory" },
              { value: "learning", label: "Learning" },
            ]}
            onChange={(value) =>
              updateSetting("aiDefaultOutputStyle", value as "default" | "explanatory" | "learning")
            }
            size="xs"
          />
        </SettingRow>

        {availableModes.length > 0 && (
          <SettingRow
            label="Default Session Mode"
            description="Default mode for ACP agent sessions"
          >
            <Dropdown
              value={settings.aiDefaultSessionMode || ""}
              options={[
                { value: "", label: "None" },
                ...availableModes.map((mode) => ({
                  value: mode.id,
                  label: mode.name,
                })),
              ]}
              onChange={(value) => updateSetting("aiDefaultSessionMode", value)}
              size="xs"
            />
          </SettingRow>
        )}
      </Section>

      <Section title="Behavior">
        <SettingRow
          label="Auto Open Read Files"
          description="Automatically open files in the editor when AI reads them"
        >
          <Switch
            checked={settings.aiAutoOpenReadFiles}
            onChange={(checked) => updateSetting("aiAutoOpenReadFiles", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Chat History">
        <SettingRow label="Clear All Chats" description="Permanently delete all chat history">
          <Button
            variant="outline"
            size="xs"
            onClick={async () => {
              if (
                window.confirm(
                  "Are you sure you want to delete all chat history? This action cannot be undone.",
                )
              ) {
                setIsClearingChats(true);
                try {
                  await useAIChatStore.getState().clearAllChats();
                } finally {
                  setIsClearingChats(false);
                }
              }
            }}
            disabled={isClearingChats}
            className="gap-1.5 text-red-500 hover:bg-red-500/10"
          >
            <Trash2 size={12} />
            {isClearingChats ? "Clearing..." : "Clear All"}
          </Button>
        </SettingRow>
      </Section>

      <Section title="Autocomplete">
        <SettingRow
          label="Enable AI Autocomplete"
          description={
            canEnableAutocomplete
              ? "Show inline AI suggestions while typing"
              : "Set an API key to enable autocomplete"
          }
        >
          <Switch
            checked={settings.aiCompletion && canEnableAutocomplete}
            onChange={(checked) => {
              if (!canEnableAutocomplete) return;
              updateSetting("aiCompletion", checked);
            }}
            size="sm"
            disabled={!canEnableAutocomplete}
          />
        </SettingRow>

        {autocompleteProviderOptions.length > 0 && (
          <SettingRow label="Autocomplete Provider" description="Choose autocomplete engine">
            <Dropdown
              value={settings.aiAutocompleteProviderId}
              options={autocompleteProviderOptions}
              onChange={handleAutocompleteProviderChange}
              size="xs"
              searchable={autocompleteProviderOptions.length > 5}
            />
          </SettingRow>
        )}

        {currentAutocompleteProvider?.requiresApiKey && (
          <SettingRow
            label={`${currentAutocompleteProvider.name} API Key`}
            description="Required for inline autocomplete"
          >
            {renderAutocompleteKeyInput()}
          </SettingRow>
        )}
      </Section>
    </div>
  );
};
