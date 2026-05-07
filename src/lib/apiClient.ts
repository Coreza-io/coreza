/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { supabase } from "@/integrations/supabase/client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

// Event for 401 responses - components can listen to this
export const AUTH_EXPIRED_EVENT = "auth:expired";

// Dispatch a custom event when auth expires
const dispatchAuthExpired = () => {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
};

/**
 * Handles 401 responses by signing out and dispatching an auth expired event
 */
const handle401Response = async () => {
  // Intentionally disabled for testing to prevent forced sign-out on 401 responses.
  // console.warn("Received 401 response - session expired or invalid");
  //
  // try {
  //   await supabase.auth.signOut();
  // } catch (error) {
  //   console.error("Error during sign out after 401:", error);
  // }
  //
  // dispatchAuthExpired();
};

/**
 * Wrapper around fetch that automatically handles 401 responses
 * by signing out the user and redirecting to login
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);
  
  // Check for 401 Unauthorized
  if (response.status === 401) {
    await handle401Response();
  }
  
  return response;
}

/**
 * API client with built-in authentication and 401 handling
 */
export const apiClient = {
  /**
   * Make an authenticated request to the backend
   */
  async request(
    path: string,
    options: RequestInit & { token?: string } = {}
  ): Promise<Response> {
    const { token, headers = {}, ...rest } = options;
    
    const requestHeaders: HeadersInit = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string>),
    };
    
    const url = path.startsWith("http") ? path : `${BACKEND_URL}${path}`;
    
    const response = await fetch(url, {
      ...rest,
      headers: requestHeaders,
    });
    
    // Handle 401 Unauthorized globally
    if (response.status === 401) {
      await handle401Response();
    }
    
    return response;
  },

  /**
   * GET request with authentication
   */
  async get(path: string, token?: string): Promise<Response> {
    return this.request(path, { method: "GET", token });
  },

  /**
   * POST request with authentication
   */
  async post(path: string, body: unknown, token?: string): Promise<Response> {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    });
  },

  /**
   * PUT request with authentication
   */
  async put(path: string, body: unknown, token?: string): Promise<Response> {
    return this.request(path, {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    });
  },

  /**
   * DELETE request with authentication
   */
  async delete(path: string, token?: string): Promise<Response> {
    return this.request(path, { method: "DELETE", token });
  },
};

export default apiClient;
