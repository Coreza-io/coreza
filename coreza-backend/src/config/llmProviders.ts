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
import { isSolModel, resolveSolEffort, SOL_MAX_OUTPUT_TOKENS } from './openAIModelCapabilities';

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface LLMConfig {
  apiKey: string;
  model: string;

  // Standard chat models
  temperature?: number;
  maxTokens?: number;

  // Model capability flags from selected model option/config
  isSearchModel?: boolean;
  isReasoningModel?: boolean;

  // The factory also validates model-specific capabilities for headless callers.
  reasoningEffort?: ReasoningEffort;

  // Extra provider-specific params
  modelKwargs?: Record<string, unknown>;
}

type LLMFactory = (config: LLMConfig) => BaseChatModel;

function buildOpenAIModelKwargs(config: LLMConfig): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {
    ...(config.modelKwargs ?? {}),
  };
  if (kwargs.reasoning_effort === 'max' || (kwargs.reasoning as { effort?: unknown } | undefined)?.effort === 'max') {
    throw new Error('The max reasoning effort is only configured for gpt-6.1-sol');
  }

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
    if (isSolModel('openai', config.model)) {
      const effort = resolveSolEffort(config.reasoningEffort);
      if (config.maxTokens !== undefined && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0 || config.maxTokens > SOL_MAX_OUTPUT_TOKENS)) {
        throw new Error(`gpt-6.1-sol maxTokens must be a positive integer no greater than ${SOL_MAX_OUTPUT_TOKENS}`);
      }
      const reserved = ['model', 'modelName', 'useResponsesApi', 'reasoning', 'reasoning_effort',
        'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'max_output_tokens',
        'store', 'include', 'previous_response_id', 'conversation', 'service_tier', 'background',
        'input', 'messages', 'tools', 'tool_choice', 'functions', 'function_call', 'web_search_options', 'stream'];
      if (reserved.some(key => Object.prototype.hasOwnProperty.call(config.modelKwargs ?? {}, key))) {
        throw new Error('gpt-6.1-sol endpoint, reasoning, sampling, token, tool and conversation settings cannot be overridden through modelKwargs');
      }
      return new ChatOpenAI({
        apiKey: config.apiKey,
        modelName: config.model,
        useResponsesApi: true,
        maxTokens: config.maxTokens,
        // The locked adapter only recognizes o*/gpt-5 in its typed reasoning path.
        // Responses spreads these kwargs unchanged, including the nested effort.
        modelKwargs: { ...config.modelKwargs, reasoning: { effort }, store: false,
          include: ['reasoning.encrypted_content'] },
        // Keep native reasoning/tool items for local replay; zdrEnabled strips them.
      });
    }
    if (config.reasoningEffort === 'max') throw new Error('The max reasoning effort is only configured for gpt-6.1-sol');
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

  if (config.reasoningEffort === 'max' && !isSolModel(provider, config.model)) {
    throw new Error('The max reasoning effort is only configured for gpt-6.1-sol');
  }

  return factory(config);
}
