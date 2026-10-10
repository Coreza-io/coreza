import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditFieldEditor } from "../../../src/components/nodes/layout/RepeaterNodeLayout";
import type { TypedEditFieldRow } from "../../../coreza-backend/src/nodes/logic/typedEditFieldRow";
import "../../../src/index.css";

function Fixture() {
  const [count, setCount] = useState(5);
  const [row, setRow] = useState<TypedEditFieldRow>({ fieldName: "var1", dataType: "array", valueMode: "expression", value: '{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}' });
  const getExpressionContext = React.useCallback(() => ({
    input: {}, nodes: {}, hasInput: true,
    expressionOutputs: {
      get_atr_history: { success: true, status: "success", data: { value: [1,2,3,4,5,6,7,8] } },
      short_len: { success: true, status: "success", data: count },
    },
    definitions: [{ id: "get_atr_history" }, { id: "short_len" }],
  }), [count]);
  return <main style={{ padding: 30, width: 600 }}>
    <button onClick={() => setCount(0)}>Set zero count</button>
    <EditFieldEditor row={row} index={0} canRemove={false} remove={() => {}} makeReference={() => null} getExpressionContext={getExpressionContext}
      update={(_, field, value) => { setRow(current => ({ ...current, [field]: value })); return true; }}
      updateMany={(_, values) => { setRow(current => ({ ...current, ...values })); return true; }}/>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
