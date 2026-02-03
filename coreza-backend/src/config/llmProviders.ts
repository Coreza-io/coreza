/*
 * Copyright (C) 2024 Coreza
 * LLM Provider Factory registry
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface LLMConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  modelKwargs?: Record<string, unknown>;
}

type LLMFactory = (config: LLMConfig) => BaseChatModel;

/**
 * Minimal factory registry - only maps provider → LangChain class
 * All other config comes from frontend JSON
 */
export const LLM_FACTORIES: Record<string, LLMFactory> = {
  openai: ({ apiKey, model, temperature, maxTokens, modelKwargs }) => {
    return new ChatOpenAI({
      modelName: model,
      apiKey,
      temperature,
      maxTokens,
      modelKwargs,
    });
  },

  gemini: ({ apiKey, model, temperature, maxTokens }) => {
    return new ChatGoogleGenerativeAI({
      modelName: model,
      apiKey,
      temperature,
      maxOutputTokens: maxTokens,
    });
  },

  // Future providers can be added here:
  // anthropic: { ... },
  // mistral: { ... },
};

export function createLLM(provider: string, config: LLMConfig): BaseChatModel {
  const factory = LLM_FACTORIES[provider];
  if (!factory) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
  return factory(config);
}
