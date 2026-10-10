import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";

// One request per authenticated token; a response for an old token cannot enable a new session.
const requests = new Map<string, Promise<boolean>>();
export function useSafeExpressionHelpers(): boolean {
  const { session } = useAuth();
  const token = session?.access_token;
  const [observed, setObserved] = useState<{ token?: string; supported: boolean }>({ supported: false });
  useEffect(() => {
    let live = true;
    if (!token) return;
    let request = requests.get(token);
    if (!request) {
      request = apiClient.get("/workflows/capabilities", token)
        .then(response => response.ok ? response.json() : null)
        .then(data => data?.safe_expression_helpers?.lastN?.contract_version === 1 && data?.safe_expression_helpers?.lastN?.scope === "typed-edit-fields-v2")
        .catch(() => false);
      requests.clear();
      requests.set(token, request);
    }
    void request.then(supported => { if (live) setObserved({ token, supported }); });
    return () => { live = false; };
  }, [token]);
  return !!token && observed.token === token && observed.supported;
}
