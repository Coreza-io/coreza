import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useReferenceTextDrop, planReferenceTextDrop, finishReferenceTextDrop } from "../../../src/hooks/useReferenceTextDrop";
import NodeFieldRenderer from "../../../src/components/nodes/layout/components/NodeFieldRenderer";
import { buildNodeReference, createJsonReferenceDragPayload, parseJsonReferenceDragPayload } from "../../../src/utils/referencePath";
import { textControlCaret } from "../../../src/utils/textControlCaret";
import "../../../src/index.css";

const reference = '{{ $("history").json.items }}';
function Fixture() {
  const [generic, setGeneric] = useState("abcdef");
  const [number, setNumber] = useState("12");
  const [restoreBlocked, setRestoreBlocked] = useState(false);
  const [typed, setTyped] = useState({ value: "abcdef", mode: "fixed" });
  const [disabled, setDisabled] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [session, setSession] = useState(0);
  const hook = useReferenceTextDrop({ value: typed.value, meta: typed.mode, onChange: value => setTyped(current => ({ ...current, value })), onRestore: (value, mode) => { if (restoreBlocked) return false; setTyped({ value, mode: String(mode) }); return true; }, disabled, identity: session });
  const makeReference = (event: React.DragEvent) => {
    const payload = parseJsonReferenceDragPayload(event.dataTransfer.getData("application/reactflow"));
    return payload ? buildNodeReference(payload, [{ id: "history" }]) : null;
  };
  const drop = (event: React.DragEvent) => {
    event.preventDefault(); event.stopPropagation(); hook.bind(event); hook.clearCaret();
    const ref = makeReference(event); if (!ref) return;
    const insertion = planReferenceTextDrop(event, ref, typed.mode === "expression");
    if (!insertion) return;
    setTyped({ value: insertion.value, mode: "expression" });
    finishReferenceTextDrop(event, insertion, "expression");
  };
  Object.assign(window, { fixtureCaret: textControlCaret, fixtureSetTyped: setTyped, fixtureSetGeneric: setGeneric });
  return <main style={{ padding: 30 }}>
    <div id="source" draggable onDragStart={event => event.dataTransfer.setData("application/reactflow", JSON.stringify(createJsonReferenceDragPayload(["items"], "history", "[]")))} style={{ marginBottom: 25 }}>Drag history reference</div>
    <button onClick={() => setDisabled(!disabled)}>Toggle disabled</button>
    <button onClick={() => setRestoreBlocked(!restoreBlocked)}>Toggle restore guard</button>
    <button onClick={() => setZoom(zoom === 1 ? 1.5 : 1)}>Toggle zoom</button>
    <button onClick={() => { setSession(session + 1); setTyped({ value: "restored", mode: "fixed" }); }}>Restore document</button>
    <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: 400, marginTop: 20 }}>
      <section id="generic" style={{ marginBottom: 30 }}>
        <NodeFieldRenderer field={{ key: "value", type: "string", label: "Generic" }} definition={{}} fieldState={{}} value={generic} selectOptions={{}} loadingSelect={{}} readOnly={disabled} onChange={(_, value) => setGeneric(value)} onDrop={(_, event) => {
          const ref = makeReference(event); if (!ref) return;
          const insertion = planReferenceTextDrop(event, ref);
          if (insertion) { setGeneric(insertion.value); finishReferenceTextDrop(event, insertion); }
        }}/>
      </section>
      <section id="typed" onDrop={drop} onDragOver={hook.props.onDragOver} onDragLeave={hook.props.onDragLeave}>
        <label>Typed {typed.mode}</label>
        {typed.mode === "expression" ? <textarea {...hook.props} ref={hook.controlRef as React.MutableRefObject<HTMLTextAreaElement | null>} value={typed.value} disabled={disabled} onDrop={drop} style={{ display: "block", width: 260, height: 110, padding: 12, border: "2px solid gray", font: "16px/24px monospace", tabSize: 4 }}/>
        : <input {...hook.props} ref={hook.controlRef as React.MutableRefObject<HTMLInputElement | null>} value={typed.value} disabled={disabled} onDrop={drop} style={{ display: "block", width: 260, height: 48, padding: 12, border: "2px solid gray", font: "16px/24px monospace" }}/>}</section>
      <output id="mode">{typed.mode}</output><output id="generic-value">{generic}</output>
      <section id="number"><NodeFieldRenderer field={{ key: "number", type: "number", label: "Number" }} definition={{}} fieldState={{}} value={number} selectOptions={{}} loadingSelect={{}} readOnly={disabled} onChange={(_, value) => setNumber(value)} /></section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
