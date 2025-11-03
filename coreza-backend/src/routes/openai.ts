import { Router, Request, Response } from "express";
import axios from "axios";
import CredentialManager from "../utils/credentialManager";
import { supabase } from "../config/supabase";

const router = Router();

// POST /auth-url - Store OpenAI credentials securely
router.post("/auth", async (req: Request, res: Response, next) => {
  try {
    const { user_id, credential_name, apiKey } = req.body;

    if (!user_id || !credential_name || !apiKey) {
      return res
        .status(400)
        .json({
          error:
            "Missing required parameters: user_id, credential_name, apiKey",
        });
    }

    // Store credentials using CredentialManager (v2 encryption)
    await CredentialManager.storeCredentials(
      user_id,
      "openai",
      credential_name,
      { apiKey }
    );

    // Get the credential_id for reference
    const { data, error } = await supabase
      .from("user_credentials")
      .select("id")
      .eq("user_id", user_id)
      .eq("service_type", "openai")
      .eq("name", credential_name)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "OpenAI credentials saved successfully",
      credential_id: data.id,
    });
  } catch (error) {
    console.error("Error storing OpenAI credentials:", error);
    next(error);
  }
});

router.post("/chat", async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      credential_id,
      model,
      prompt,
      userMessage,
      temperature = 0.7,
      maxTokens = 1000,
    } = req.body;

    const {
      credentials: { client_json, token_json },
    } = await CredentialManager.getCredentials(
      user_id,
      "openai",
      credential_id
    );

    const { apiKey } = client_json;

    if (!apiKey) {
      return res.status(400).json({ error: "API key is required" });
    }

    const messages = [
      { role: "system", content: prompt || "You are a helpful assistant." },
      { role: "user", content: userMessage },
    ];

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const completion = response.data.choices[0].message.content;
    const usage = response.data.usage;

    res.json({
      success: true,
      data: {
        response: completion,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
      },
    });
  } catch (error: any) {
    console.error("OpenAI API error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error?.message ||
        error.message ||
        "OpenAI API request failed",
    });
  }
});

export default router;
