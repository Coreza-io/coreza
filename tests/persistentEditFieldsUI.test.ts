import React from "react";
import { act, create } from "react-test-renderer";
const mockChange = jest.fn();
const mockSubmit = jest.fn();
const mockInsertion = jest.fn();
let mockPreviewOpen = false;
jest.mock("@/contexts/StableNodeContext", () => ({ useStableNodes: () => ({ getNodes: () => [] }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
jest.mock("@/contexts/ExecutionStoreContext", () => ({ useExecutionStore: () => ({ getNodeData: () => ({}) }), useExecutionStoreVersion: () => 0 }));
jest.mock("@/hooks/useVariableSnapshot", () => ({ useVariableSnapshot: () => ({ data: { values: { bonus: 0 } } }) }));
jest.mock("@/hooks/useFieldPreview", () => ({ useFieldPreview: (enabled: boolean, content: any) => ({ isOpen: enabled && mockPreviewOpen, open: jest.fn(), wrapperRef: { current: null }, popup: enabled && mockPreviewOpen ? React.createElement("aside", null, content) : null }) }));
jest.mock("@/hooks/useReferenceTextDrop", () => ({ ...jest.requireActual("@/hooks/useReferenceTextDrop"), useReferenceTextDrop: () => ({ props: {}, controlRef: { current: null }, recordInsertion: mockInsertion, clearCaret: jest.fn() }) }));
jest.mock("@/components/ui/select", () => {
  const component = ({ children, ...props }: any) => React.createElement("div", props, children);
  return { Select: component, SelectContent: component, SelectItem: component, SelectTrigger: component, SelectValue: component };
});
jest.mock("@/components/nodes/visualize/VisualizeNodePreview", () => () => null);
jest.mock("@/components/nodes/layout/components/LayoutAuthModal", () => () => null);
jest.mock("@/components/nodes/layout/components/NodeFieldRenderer", () => ({ __esModule: true, default: (props: any) => React.createElement("button", { onClick: () => props.onChange(props.field.key, !props.value), "data-field": props.field.key }, props.field.label) }));
import RepeaterNodeLayout, { EditFieldEditor } from "@/components/nodes/layout/RepeaterNodeLayout";
import definition from "@/nodes/Field.json";

test("typed Edit Fields allows Persistent on/off and submits explicit Execute", () => {
  const props: any = { definition, fieldState: { persistent: false, fields: [{ fieldName: "bonus", dataType: "number", valueMode: "fixed", value: "0" }] }, workflowId: "workflow",
    handleChange: mockChange, handleSubmit: mockSubmit, handleFieldStateBatch: jest.fn(), getFieldPreview: () => null,
    previousNodes: [], selectedPrevNodeId: "", loadingSelect: {}, selectOptions: {}, selectedInputData: {}, incomingEdgeCount: 0, readOnly: false };
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(React.createElement(RepeaterNodeLayout, props)); });
  act(() => renderer!.root.findByProps({ "data-field": "persistent" }).props.onClick());
  expect(mockChange).toHaveBeenCalledWith("persistent", true);
  act(() => renderer!.update(React.createElement(RepeaterNodeLayout, { ...props, fieldState: { ...props.fieldState, persistent: true } })));
  act(() => renderer!.root.findByProps({ "data-field": "persistent" }).props.onClick());
  expect(mockChange).toHaveBeenCalledWith("persistent", false);
  act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault: jest.fn() }));
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  act(() => renderer!.unmount());
});

test("typed variable insertion and preview use the same scoped value without writes", () => {
  jest.useFakeTimers();
  (globalThis as any).window = { setTimeout, clearTimeout };
  mockPreviewOpen = true;
  const update = jest.fn();
  const props: any = { row: { fieldName: "bonus", dataType: "number", valueMode: "expression", value: "{{ $vars.bonus }}" }, index: 0, variableNames: ["bonus"], update, updateMany: jest.fn(), canRemove: false,
    getExpressionContext: () => ({ input: {}, nodes: {}, definitions: [], variables: { bonus: 0 }, hasInput: false }), makeReference: () => null };
  let renderer: ReturnType<typeof create>;
  try {
    act(() => { renderer = create(React.createElement(EditFieldEditor, props)); });
    act(() => jest.advanceTimersByTime(250));
    expect(JSON.stringify(renderer!.toJSON())).toContain('"0"');
    expect(update).not.toHaveBeenCalled();
    act(() => renderer!.root.findByProps({ "aria-label": "Insert workflow variable" }).props.onChange({ target: { value: "bonus" } }));
    expect(update).toHaveBeenCalledWith(0, "value", "{{ $vars.bonus }}{{ $vars.bonus }}");
    expect(mockInsertion).toHaveBeenCalledWith(expect.objectContaining({ value: "{{ $vars.bonus }}{{ $vars.bonus }}" }), "expression");
  } finally { act(() => renderer!.unmount()); mockPreviewOpen = false; delete (globalThis as any).window; jest.useRealTimers(); }
});
