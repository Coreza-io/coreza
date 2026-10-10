import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { AuthProvider } from "../../../src/contexts/AuthContext";
import { supabase } from "../../../src/integrations/supabase/client";
import { apiClient } from "../../../src/lib/apiClient";
import { EditFieldEditor } from "../../../src/components/nodes/layout/RepeaterNodeLayout";
import type { TypedEditFieldRow } from "../../../coreza-backend/src/nodes/logic/typedEditFieldRow";
import "../../../src/index.css";

// Exercise the real editor and capability hook without an external authenticated session.
supabase.auth.getSession = async () => ({ data: { session: { access_token: "fixture", user: { id: "fixture" } } as Session }, error: null });
supabase.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } }) as ReturnType<typeof supabase.auth.onAuthStateChange>;
apiClient.get = async () => new Response(JSON.stringify(new URLSearchParams(location.search).has("unsupported") ? {} : {
  safe_expression_helpers: { lastN: { contract_version: 1, scope: "typed-edit-fields-v2" } },
}), { headers: { "Content-Type": "application/json" } });
const context = {
  input: {}, nodes: {}, hasInput: true,
  helperOutputs: {
    get_atr_history: { success: true, status: "success", data: { value: [1,2,3,4,5,6,7,8] } },
    short_len: { success: true, status: "success", data: 5 },
  },
  definitions: [{ id: "get_atr_history" }, { id: "short_len" }],
};
const getExpressionContext = () => context;
function Fixture() {
  const [row, setRow] = useState<TypedEditFieldRow>({ fieldName: "var1", dataType: "array", valueMode: "expression", value: '{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}' });
  return <main style={{ padding: 30, width: 600 }}><EditFieldEditor row={row} index={0} canRemove={false} remove={() => {}} makeReference={() => null} getExpressionContext={getExpressionContext}
    update={(_, field, value) => { setRow(current => ({ ...current, [field]: value })); return true; }}
    updateMany={(_, values) => { setRow(current => ({ ...current, ...values })); return true; }}/></main>;
}
createRoot(document.getElementById("root")!).render(<AuthProvider><Fixture/></AuthProvider>);
