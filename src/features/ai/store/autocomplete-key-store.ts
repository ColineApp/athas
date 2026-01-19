import { create } from "zustand";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/utils/token-manager";
import { createSelectors } from "@/utils/zustand-selectors";
import "@/utils/autocomplete-provider-registry";
import { useSettingsStore } from "@/features/settings/store";
import { getAutocompleteProvider } from "@/utils/autocomplete-providers";

interface AutocompleteKeyState {
  providerKeys: Map<string, boolean>;
  isChecking: boolean;
  actions: {
    checkKey: (providerId: string) => Promise<void>;
    saveKey: (providerId: string, apiKey: string) => Promise<boolean>;
    removeKey: (providerId: string) => Promise<void>;
  };
}

const disableAiCompletionIfMissing = () => {
  const { settings, updateSetting } = useSettingsStore.getState();
  if (settings.aiCompletion) {
    void updateSetting("aiCompletion", false);
  }
};

export const useAutocompleteKeyStore = createSelectors(
  create<AutocompleteKeyState>()((set, _get) => ({
    providerKeys: new Map(),
    isChecking: false,
    actions: {
      checkKey: async (providerId) => {
        const provider = getAutocompleteProvider(providerId);
        if (!provider) return;

        set({ isChecking: true });
        try {
          if (!provider.requiresApiKey) {
            set((state) => {
              const next = new Map(state.providerKeys);
              next.set(providerId, true);
              return { providerKeys: next };
            });
            return;
          }

          const token = await getProviderApiToken(providerId);
          set((state) => {
            const next = new Map(state.providerKeys);
            next.set(providerId, !!token);
            return { providerKeys: next };
          });

          if (!token) {
            disableAiCompletionIfMissing();
          }
        } catch {
          set((state) => {
            const next = new Map(state.providerKeys);
            next.set(providerId, false);
            return { providerKeys: next };
          });
          disableAiCompletionIfMissing();
        } finally {
          set({ isChecking: false });
        }
      },
      saveKey: async (providerId, apiKey) => {
        const provider = getAutocompleteProvider(providerId);
        if (!provider) return false;
        try {
          const isValid = await provider.validateApiKey(apiKey);
          if (!isValid) return false;
          await storeProviderApiToken(providerId, apiKey);
          set((state) => {
            const next = new Map(state.providerKeys);
            next.set(providerId, true);
            return { providerKeys: next };
          });
          return true;
        } catch {
          return false;
        }
      },
      removeKey: async (providerId) => {
        const provider = getAutocompleteProvider(providerId);
        if (!provider) return;
        await removeProviderApiToken(providerId);
        set((state) => {
          const next = new Map(state.providerKeys);
          next.set(providerId, false);
          return { providerKeys: next };
        });
        if (provider.requiresApiKey) {
          disableAiCompletionIfMissing();
        }
      },
    },
  })),
);
