import { useEffect, useState } from 'react';
import { useOptionalAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/lib/apiClient';
const requests = new Map<string, Promise<boolean>>();
/** One request per authenticated session, shared by all node editors. Fail closed. */
export function useExpressionCapability(): boolean {
  const session = useOptionalAuth()?.session;
  const token = session?.access_token;
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true; setSupported(false);
    if (token) {
      if (!requests.has(token)) {
        if (requests.size >= 2) requests.clear();
        requests.set(token, apiClient.get('/workflows/capabilities', token)
          .then(async response => response.ok ? response.json() : null)
          .then(data => data?.expression_format_version === 1).catch(() => false));
      }
      void requests.get(token)!.then(value => { if (live) setSupported(value); });
    }
    return () => { live = false; };
  }, [token]);
  return supported;
}
