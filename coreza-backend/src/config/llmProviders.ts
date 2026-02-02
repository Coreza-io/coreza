/*
 * Copyright (C) 2024 Coreza
 * LLM Provider Registry - Factory pattern for multi-provider support
 * 
 * To add a new provider:
 * 1. Import the LangChain model class
 * 2. Add config to LLM_PROVIDERS
 * 3. Create frontend JSON node with matching "provider" field
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface LLMProviderConfig {
  /** Provider identifier (matches JSON provider field) */
  id: string;

  /** Service type for credential lookup in DB */
  serviceType: string;

  /** Key in client_json for API key */
  apiKeyField: string;

  /** Models that don't support temperature parameter */
  noTemperatureModels?: string[];

  /** Default model if none specified */
  defaultModel: string;

  /** Factory to create LangChain chat model */
  createModel: (config: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) => BaseChatModel;
}

export const LLM_PROVIDERS: Record<string, LLMProviderConfig> = {
  openai: {
    id: "openai",
    serviceType: "openaichatmodel",
    apiKeyField: "apiKey",
    noTemperatureModels: [
      "gpt-4o-search-preview",
      "gpt-4o-mini-search-preview",
    ],
    defaultModel: "gpt-4o-mini",
    createModel: ({ apiKey, model, temperature, maxTokens }) => {
      const isSearchModel =
        LLM_PROVIDERS.openai.noTemperatureModels?.includes(model);

      const config: Record<string, unknown> = {
        modelName: model,
        apiKey,
      };

      if (!isSearchModel) {
        config.temperature = temperature ?? 0.7;
        if (maxTokens) {
          config.maxTokens = maxTokens;
        }
      } else {
        // Search models require web_search_options
        config.modelKwargs = { web_search_options: {} };
      }

      return new ChatOpenAI(config);
    },
  },

  gemini: {
    id: "gemini",
    serviceType: "geminichatmodel",
    apiKeyField: "apiKey",
    defaultModel: "gemini-1.5-flash",
    createModel: ({ apiKey, model, temperature, maxTokens }) => {
      return new ChatGoogleGenerativeAI({
        modelName: model,
        apiKey,
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxTokens,
      });
    },
  },

  // Future providers can be added here:
  // anthropic: { ... },
  // mistral: { ... },
};

/**
 * Get provider config by ID, with fallback to openai
 */
export function getProvider(providerId?: string): LLMProviderConfig {
  if (!providerId) {
    return LLM_PROVIDERS.openai;
  }
  return LLM_PROVIDERS[providerId] || LLM_PROVIDERS.openai;
}

/**
 * Check if model supports temperature for given provider
 */
export function supportsTemperature(
  providerId: string,
  model: string
): boolean {
  const provider = getProvider(providerId);
  return !provider.noTemperatureModels?.includes(model);
}
