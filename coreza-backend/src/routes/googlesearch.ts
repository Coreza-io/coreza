import express from "express";
import CredentialManager from "../utils/credentialManager";
import axios from "axios";
import { z } from "zod";

const router = express.Router();

// Validation schemas
const credentialsSchema = z.object({
  api_key: z.string().min(1, "API key is required"),
  search_engine_id: z.string().min(1, "Search Engine ID is required"),
});

const searchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Search query cannot be empty")
    .max(500, "Search query must be less than 500 characters"),
  numResults: z.number().int().min(1).max(10).optional(),
});

// Get user credentials list
router.get("/credentials", async (req, res, next) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const credentials = await CredentialManager.listCredentials(
      user_id as string,
      "googlesearch"
    );

    res.json({
      success: true,
      credentials: credentials || [],
    });
  } catch (error) {
    next(error);
  }
});

// Save and validate credentials
router.post("/auth-url", async (req, res, next) => {
  try {
    const { user_id, credential_name, api_key, search_engine_id } = req.body;

    if (!user_id || !credential_name || !api_key || !search_engine_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Validate credentials format
    const validatedCreds = credentialsSchema.parse({
      api_key,
      search_engine_id,
    });

    // Test the credentials with a simple search
    try {
      const testUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
        validatedCreds.api_key
      )}&cx=${encodeURIComponent(
        validatedCreds.search_engine_id
      )}&q=test&num=1`;
      const testResponse = await axios.get(testUrl);

      if (testResponse.status !== 200) {
        return res
          .status(401)
          .json({ error: "Invalid Google Search API credentials" });
      }
    } catch (error: any) {
      console.error(
        "Google Search API validation error:",
        error.response?.data || error.message
      );
      return res.status(401).json({
        error: "Invalid Google Search API credentials or API quota exceeded",
        details: error.response?.data?.error?.message,
      });
    }

    // Save credentials
    const credential_id = await CredentialManager.saveCredentials(
      user_id,
      "googlewebsearch",
      credential_name,
      {
        api_key: validatedCreds.api_key,
        search_engine_id: validatedCreds.search_engine_id,
      }
    );

    res.json({
      success: true,
      credential_id,
      message: "Google Search credentials saved successfully",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

// Execute search
router.post("/execute", async (req, res, next) => {
  try {
    const { user_id, credential_id, query, numResults = 10 } = req.body;

    if (!user_id || !credential_id || !query) {
      return res
        .status(400)
        .json({ error: "user_id, credential_id, and query are required" });
    }

    // Validate input
    const validatedInput = searchQuerySchema.parse({ query, numResults });

    // Get credentials
    const { credentials } = await CredentialManager.getCredentials(
      user_id,
      "googlewebsearch",
      credential_id
    );

    const { api_key, search_engine_id } = credentials.client_json;

    // Execute Google Custom Search
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(
      api_key
    )}&cx=${encodeURIComponent(search_engine_id)}&q=${encodeURIComponent(
      validatedInput.query
    )}&num=${validatedInput.numResults}`;

    const response = await axios.get(searchUrl);

    if (!response.data || !response.data.items) {
      return res.json({
        success: true,
        data: {
          query: validatedInput.query,
          results: [],
          searchInformation: response.data.searchInformation || {},
        },
      });
    }

    // Format results
    const results = response.data.items.map((item: any) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      displayLink: item.displayLink,
    }));

    res.json({
      success: true,
      data: {
        query: validatedInput.query,
        results,
        searchInformation: response.data.searchInformation,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error(
      "Google Search execution error:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Search execution failed",
      details: error.response?.data?.error?.message || error.message,
    });
  }
});

export default router;
