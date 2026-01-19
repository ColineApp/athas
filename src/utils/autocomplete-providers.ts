export type AutocompleteDocumentType = "plaintext" | "markdown" | "code";

export interface AutocompleteContext {
  documentType?: AutocompleteDocumentType;
  boxiaEntityType?: string;
  boxiaEntityField?: string;
  cursorContext?: string;
  recentText?: string[];
  rejectedSuggestions?: string[];
}

export interface AutocompleteRequest {
  text: string;
  cursorPosition: number;
  maxTokens?: number;
  temperature?: number;
  context?: AutocompleteContext;
}

export interface AutocompleteResponse {
  suggestion: string;
  confidence?: number;
  latencyMs?: number;
  model?: string;
  tokenCount?: number;
}

export interface AutocompleteError {
  status: number;
  code?: string;
  message: string;
  requestId?: string;
  raw?: string;
}

export interface AutocompleteStreamHandlers {
  onSuggestion: (suggestion: string) => void;
  onComplete: () => void;
  onError: (error: AutocompleteError) => void;
}

export interface AutocompleteProvider {
  id: string;
  name: string;
  requiresApiKey: boolean;
  requestCompletion: (
    request: AutocompleteRequest,
    apiKey: string,
    signal?: AbortSignal,
  ) => Promise<AutocompleteResponse>;
  streamCompletion: (
    request: AutocompleteRequest,
    apiKey: string,
    handlers: AutocompleteStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<void>;
  validateApiKey: (apiKey: string) => Promise<boolean>;
}

const providers = new Map<string, AutocompleteProvider>();

export const registerAutocompleteProvider = (provider: AutocompleteProvider) => {
  providers.set(provider.id, provider);
};

export const getAutocompleteProvider = (id: string): AutocompleteProvider | undefined => {
  return providers.get(id);
};

export const getAutocompleteProviders = (): AutocompleteProvider[] => {
  return Array.from(providers.values());
};
