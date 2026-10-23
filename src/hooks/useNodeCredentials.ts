import { readNodeResult } from "@/utils/nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useCallback, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { isFieldVisible } from "@/utils/fieldVisibility";
import { apiClient } from "@/lib/apiClient";

interface UseNodeCredentialsProps {
  definition: any;
  fieldState: Record<string, any>;
  workflowId?: string;
  workflowSessionId?: string;
  enabled?: boolean;
}

interface OptionResource {
  fieldKey: string;
  kind: string;
  key: readonly unknown[];
  url: string;
  body?: Record<string, unknown>;
  available: boolean;
}

const EMPTY_OPTIONS: any[] = [];

/** One query owner per resource. Ordinary field edits never change resource keys. */
export function useNodeCredentials({ definition, fieldState, workflowId, workflowSessionId, enabled = true }: UseNodeCredentialsProps) {
  const { user, session, loading } = useAuth();
  const client = useQueryClient();
  const authRef = useRef({ owner: user?.id, token: session?.access_token });
  authRef.current = { owner: user?.id, token: session?.access_token };
  const owner = user?.id;
  const resources: OptionResource[] = [];
  const selectOptions: Record<string, any[]> = {};
  const loadingSelect: Record<string, boolean> = {};
  for (const field of definition?.fields ?? []) {
    if (field.type !== "select") continue;
    if (field.options) selectOptions[field.key] = field.options;
    const parent = field.dependsOn ? fieldState[field.dependsOn] : undefined;
    const service = String(parent || definition?.subCategory || definition?.parentNode || definition?.name || "").toLowerCase();
    const visible = isFieldVisible(field, fieldState);
    const base = { fieldKey: field.key, kind: field.optionsSource, available: visible };
    if (field.optionsSource === "credentialsApi") {
      resources.push({ ...base, key: ["node-options", owner, "credentials", service],
        url: service ? `/credentials/list?service_type=${encodeURIComponent(service)}` : "/credentials/list" });
    } else if (field.optionsSource === "storeWorkflowsApi") {
      resources.push({ ...base, key: ["node-options", owner, "store-workflows"], url: `/storage/store/workflows?user_id=${encodeURIComponent(owner ?? "")}` });
    } else if (field.optionsSource === "storeVariablesApi") {
      resources.push({ ...base, available: visible && !!parent, key: ["node-options", owner, "store-variables", parent ?? null],
        url: `/storage/store/variables?user_id=${encodeURIComponent(owner ?? "")}&workflowId=${encodeURIComponent(parent ?? "")}` });
    } else if (field.optionsSource === "dependentApi") {
      const body = { nodeName: definition.name, category: definition.category, subCategory: definition.subCategory,
        user_id: owner, credential_id: parent, workflowId, workflowSessionId };
      resources.push({ ...base, available: visible && !!parent && !!field.optionsApiUrl,
        key: ["node-options", owner, "dependent", field.optionsApiUrl, body], url: field.optionsApiUrl, body });
    }
  }
  const queries = useQueries({ queries: resources.map(resource => ({
    queryKey: resource.key,
    enabled: enabled && !loading && !!owner && !!session?.access_token && resource.available,
    // Metadata may change outside this editor; reopening refreshes it without per-keystroke requests.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      if (authRef.current.owner !== owner || !authRef.current.token) throw new Error("Option request owner changed");
      const response = await apiClient.request(resource.url, {
        method: resource.body ? "POST" : "GET", token: authRef.current.token, signal,
        ...(resource.body ? { body: JSON.stringify(resource.body) } : {}),
      });
      if (!response.ok) throw new Error(`Could not load options (${response.status})`);
      const result = await response.json();
      if (resource.kind === "credentialsApi") return (result.credentials ?? []).map((credential: any) => ({
        id: credential.id || credential.name, name: credential.name || credential.id || "Unnamed Credential",
        reconnect_required: credential.reconnect_required, reconnect_recommended: credential.reconnect_recommended,
        refresh_token_lifetime_known: credential.refresh_token_lifetime_known,
        seconds_until_reconnect: credential.seconds_until_reconnect, access_token_auto_managed: credential.access_token_auto_managed,
      }));
      if (resource.kind === "storeWorkflowsApi") return result.workflows ?? [];
      if (resource.kind === "storeVariablesApi") return (result.variables ?? []).map((name: string) => ({ id: name, name }));
      const output = readNodeResult(result);
      if (output.status !== "success") throw new Error(output.error ?? "Could not load dependent options");
      return output.data?.accounts ?? [];
    },
  })) });
  resources.forEach((resource, index) => {
    selectOptions[resource.fieldKey] = resource.available && enabled ? queries[index].data ?? EMPTY_OPTIONS : EMPTY_OPTIONS;
    loadingSelect[resource.fieldKey] = enabled && queries[index].isFetching;
  });
  const fetchCredentials = useCallback((_fieldKey: string) => {
    // Explicit credential creation/update invalidates all service lists and their accounts for this owner.
    void client.invalidateQueries({ queryKey: ["node-options", owner] }, { cancelRefetch: false });
  }, [client, owner]);
  // Dependency changes are owned by the keyed queries above, including changes from restored documents.
  const fetchDependentOptions = useCallback((_field: any, _parent: string) => {}, []);
  const fetchStoreWorkflows = useCallback((_fieldKey: string) => {
    void client.invalidateQueries({ queryKey: ["node-options", owner, "store-workflows"] });
  }, [client, owner]);
  const fetchStoreVariables = useCallback((_field: any, sourceWorkflowId: string) => {
    void client.invalidateQueries({ queryKey: ["node-options", owner, "store-variables", sourceWorkflowId] });
  }, [client, owner]);
  return { loadingSelect, selectOptions, fetchCredentials, fetchDependentOptions, fetchStoreWorkflows, fetchStoreVariables };
}
