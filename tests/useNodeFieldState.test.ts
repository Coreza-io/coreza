import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useNodeFieldState } from "@/hooks/useNodeFieldState";

let mockLocked = false;
let mockExists = true;
let mockNode = { data: { values: { value: "original", other: "keep" } } };
const mockUpdate = jest.fn((_id: string, patch: any) => { mockNode = { data: { ...mockNode.data, ...patch } }; return true; });
jest.mock("@xyflow/react", () => ({ useNodeId: () => "edit" }));
jest.mock("@/contexts/StableNodeContext", () => ({ useStableNodes: () => ({ updateNodeData: mockUpdate, getNodeById: () => mockExists ? mockNode : undefined }) }));
jest.mock("@/services/editorNodeExecution", () => ({ isEditorExecutionLocked: () => mockLocked }));

const definition = { fields: [{ key: "value", type: "string" }, { key: "other", type: "string" }] };
let hook!: ReturnType<typeof useNodeFieldState>;
function Harness({ data, readOnly = false }: { data: any; readOnly?: boolean }) { hook = useNodeFieldState({ definition, data, readOnly }); return null; }
let renderer: ReactTestRenderer;
beforeEach(() => { mockLocked = false; mockExists = true; mockUpdate.mockClear(); mockNode = { data: { values: { value: "original", other: "keep" } } }; });
afterEach(() => { act(() => renderer?.unmount()); });

test("commits each field transaction once and merges neighboring edits in the same event", () => {
  act(() => { renderer = create(React.createElement(Harness, { data: { ...mockNode.data, workflowSessionId: "session" } })); });
  mockUpdate.mockClear();
  act(() => { hook.handleChange("value", "first"); hook.handleChange("other", "second"); });
  expect(mockUpdate).toHaveBeenCalledTimes(2);
  expect(hook.fieldState).toEqual({ value: "first", other: "second" });
  expect(mockNode.data.values).toEqual(hook.fieldState);
});

test("stale callbacks cannot mutate locked, deleted, read-only or another-session fields", () => {
  act(() => { renderer = create(React.createElement(Harness, { data: { ...mockNode.data, workflowSessionId: "session" } })); });
  const old = hook.handleChange; mockUpdate.mockClear();
  mockLocked = true; act(() => old("value", "locked"));
  mockLocked = false; mockExists = false; act(() => old("value", "deleted"));
  mockExists = true;
  act(() => renderer.update(React.createElement(Harness, { data: { ...mockNode.data, workflowSessionId: "session" }, readOnly: true })));
  act(() => old("value", "readonly"));
  act(() => renderer.update(React.createElement(Harness, { data: { ...mockNode.data, workflowSessionId: "new-session" } })));
  act(() => old("value", "stale"));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockNode.data.values.value).toBe("original");
});

test("document restores replace drafts without a deferred mirror overwrite", () => {
  jest.useFakeTimers();
  act(() => { renderer = create(React.createElement(Harness, { data: mockNode.data })); });
  act(() => hook.handleChange("value", "typed"));
  mockNode = { data: { values: { value: "restored", other: "restored-neighbor" } } };
  act(() => renderer.update(React.createElement(Harness, { data: mockNode.data })));
  mockUpdate.mockClear(); act(() => jest.advanceTimersByTime(100));
  expect(mockUpdate).not.toHaveBeenCalled(); expect(hook.fieldState).toEqual(mockNode.data.values);
  jest.useRealTimers();
});
