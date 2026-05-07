/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface LLMConfig {
  apiKey: string;
  model: string;

  // Standard chat models
  temperature?: number;
  maxTokens?: number;

  // Model capability flags from selected model option/config
  isSearchModel?: boolean;
  isReasoningModel?: boolean;

  // Already normalized before reaching this factory
  reasoningEffort?: ReasoningEffort;

  // Extra provider-specific params
  modelKwargs?: Record<string, unknown>;
}

type LLMFactory = (config: LLMConfig) => BaseChatModel;

function buildOpenAIModelKwargs(config: LLMConfig): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {
    ...(config.modelKwargs ?? {}),
  };

  if (config.isSearchModel) {
    kwargs.web_search_options = {};
  }

  if (config.isReasoningModel && config.reasoningEffort) {
    kwargs.reasoning_effort = config.reasoningEffort;
  }

  return kwargs;
}

/**
 * Minimal factory registry - only maps provider → LangChain class
 * All other config comes from frontend JSON / backend config
 */
export const LLM_FACTORIES: Record<string, LLMFactory> = {
  openai: (config) => {
    const {
      apiKey,
      model,
      temperature,
      maxTokens,
      isSearchModel,
      isReasoningModel,
    } = config;

    const openAIConfig: ConstructorParameters<typeof ChatOpenAI>[0] = {
      modelName: model,
      apiKey,
      modelKwargs: buildOpenAIModelKwargs(config),
    };

    // Search models should not receive normal token/sampling params.
    if (!isSearchModel) {
      openAIConfig.maxTokens = maxTokens;
    }

    // Reasoning/search models should avoid temperature.
    if (!isSearchModel && !isReasoningModel && temperature !== undefined) {
      openAIConfig.temperature = temperature;
    }

    return new ChatOpenAI(openAIConfig);
  },

  gemini: ({ apiKey, model, temperature, maxTokens }) => {
    return new ChatGoogleGenerativeAI({
      model,
      apiKey,
      temperature,
      maxOutputTokens: maxTokens,
    });
  },

  // Future providers can be added here:
  // anthropic: { ... },
  // mistral: { ... },
};

export function getLLM(provider: string, config: LLMConfig): BaseChatModel {
  const factory = LLM_FACTORIES[provider];

  if (!factory) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }

  return factory(config);
}
