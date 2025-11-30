import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

interface UseNodeCredentialsProps {
  definition: any;
  fieldState: Record<string, any>;
}

interface UseNodeCredentialsReturn {
  loadingSelect: Record<string, boolean>;
  selectOptions: Record<string, any[]>;
  fetchCredentials: (fieldKey: string) => void;
  fetchDependentOptions: (field: any, parentValue: string) => void;
  fetchStoreWorkflows: (fieldKey: string) => void;
  fetchStoreVariables: (field: any, workflowId: string) => void;
}

/**
 * Custom hook to handle credential and option fetching
 * Manages dynamic select options from API
 */
export function useNodeCredentials({
  definition,
  fieldState,
}: UseNodeCredentialsProps): UseNodeCredentialsReturn {
  const { user, session, loading } = useAuth();
  const [loadingSelect, setLoadingSelect] = useState<Record<string, boolean>>(
    {}
  );
  const [selectOptions, setSelectOptions] = useState<Record<string, any[]>>({});

  const userId = user?.id;

  // Fetch credentials from API
  const fetchCredentials = useCallback(
    async (fieldKey: string) => {
      setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));
      try {
        const apiName = (
          definition?.subCategory ||
          definition?.parentNode ||
          definition?.name ||
          ""
        ).toLowerCase();

        // Check if userId AND access_token exist
        if (!userId || !session?.access_token) {
          console.log("No authenticated user or access token, skipping credentials fetch");
          setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
          return;
        }

        // Use credentials API for security
        const url = `${BACKEND_URL}/credentials/list?service_type=${apiName}`;
        console.log("Fetching credentials from:", url);
        console.log("API name:", apiName, "User ID:", userId);

        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            "user-id": userId,
          },
        });
        console.log("Response status:", res.status);

        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const json = await res.json();
        console.log("Credentials response:", json);
        setSelectOptions((opts) => ({
          ...opts,
          [fieldKey]: json.credentials || [],
        }));
      } catch (error) {
        console.error("Error fetching credentials:", error);
        setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
      } finally {
        setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
      }
    },
    [definition, userId, session?.access_token]
  );

  const fetchStoreWorkflows = useCallback(
    async (fieldKey: string) => {
      setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));

      if (!userId) {
        setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
        setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
        return;
      }

      try {
        const response = await fetch(
          `${BACKEND_URL}/store/workflows?user_id=${userId}`,
          {
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        setSelectOptions((opts) => ({
          ...opts,
          [fieldKey]: json.workflows || [],
        }));
      } catch (error) {
        console.error("Error fetching workflows for store options:", error);
        setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
      } finally {
        setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
      }
    },
    [userId, session?.access_token],
  );

  const fetchStoreVariables = useCallback(
    async (field: any, workflowId: string) => {
      const fieldKey = field.key;
      setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));

      if (!userId || !workflowId) {
        setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
        setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
        return;
      }

      try {
        const response = await fetch(
          `${BACKEND_URL}/store/variables?user_id=${userId}&workflow_id=${workflowId}`,
          {
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        setSelectOptions((opts) => ({
          ...opts,
          [fieldKey]: json.variables?.map((v: string) => ({ id: v, name: v })) || [],
        }));
      } catch (error) {
        console.error("Error fetching store variables:", error);
        setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
      } finally {
        setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
      }
    },
    [userId, session?.access_token],
  );

  // Fetch dependent options (cascading selects)
  const fetchDependentOptions = useCallback(
    async (field: any, parentValue: string) => {
      if (!field.optionsApiUrl || !parentValue) {
        console.warn(
          `[DEPENDENT-API] Skipping fetch - missing optionsApiUrl or parentValue`,
          {
            fieldKey: field.key,
            hasApiUrl: !!field.optionsApiUrl,
            parentValue,
          }
        );
        return;
      }

      const fieldKey = field.key;
      console.log(`[DEPENDENT-API] Fetching options for ${fieldKey}`, {
        url: field.optionsApiUrl,
        user_id: user?.id,
        credential_id: parentValue,
      });

      setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));

      try {
        const url = `${BACKEND_URL}${field.optionsApiUrl}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            user_id: user?.id,
            credential_id: parentValue,
          }),
        });

        console.log(`[DEPENDENT-API] Response status:`, response.status);

        const result = await response.json();
        console.log(`[DEPENDENT-API] Response data:`, result);

        if (result.success && result.data?.accounts) {
          setSelectOptions((prev) => ({
            ...prev,
            [fieldKey]: result.data.accounts,
          }));
        } else {
          console.error(
            `[DEPENDENT-API] Failed to fetch dependent options:`,
            result.error
          );
          setSelectOptions((prev) => ({ ...prev, [fieldKey]: [] }));
        }
      } catch (error) {
        console.error(
          `[DEPENDENT-API] Error fetching options for ${fieldKey}:`,
          error
        );
        setSelectOptions((prev) => ({ ...prev, [fieldKey]: [] }));
      } finally {
        setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
      }
    },
    [user?.id, session?.access_token]
  );

  // Load credentials and static options on mount (wait for auth to be ready)
  useEffect(() => {
    // Don't fetch until auth is resolved
    if (loading) return;
    
    (definition?.fields || []).forEach(async (f: any) => {
      if (f.type === "select" && f.optionsSource === "credentialsApi") {
        fetchCredentials(f.key);
      }
      if (f.type === "select" && f.optionsSource === "storeWorkflowsApi") {
        fetchStoreWorkflows(f.key);
      }
      if (f.type === "select" && f.options) {
        setSelectOptions((opts) => ({ ...opts, [f.key]: f.options! }));
      }
    });
  }, [definition?.fields, definition?.name, fetchCredentials, fetchStoreWorkflows, loading]);

  // Load dependent API options on mount or when parent field changes
  useEffect(() => {
    (definition?.fields || []).forEach((field: any) => {
      if (
        field.type === "select" &&
        field.optionsSource === "dependentApi" &&
        field.dependsOn &&
        fieldState[field.dependsOn]
      ) {
        fetchDependentOptions(field, fieldState[field.dependsOn]);
      }
      if (field.type === "select" && field.optionsSource === "storeVariablesApi") {
        const selectedWorkflowId = field.dependsOn ? fieldState[field.dependsOn] : undefined;

        if (selectedWorkflowId) {
          fetchStoreVariables(field, selectedWorkflowId);
        } else {
          setSelectOptions((opts) => ({ ...opts, [field.key]: [] }));
        }
      }
    });
  }, [definition?.fields, fieldState, fetchDependentOptions, fetchStoreVariables]);

  return {
    loadingSelect,
    selectOptions,
    fetchCredentials,
    fetchDependentOptions,
    fetchStoreWorkflows,
    fetchStoreVariables,
  };
}

