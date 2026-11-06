import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const mockRequest = jest.fn();
const mockPut = jest.fn();
const mockGet = jest.fn();
const mockToast = jest.fn();
const mockBlockEmpty = jest.fn();
const mockAuth = { user: { id: "owner" }, session: { access_token: "test-token" } };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
jest.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => mockToast(...args) }));
jest.mock("@/hooks/useWorkflowVersioning", () => ({ useWorkflowVersioning: () => ({ shouldBlockEmptySave: mockBlockEmpty }) }));
jest.mock("@/nodes/manifest", () => ({ nodeManifest: { Example: { name: "Example", node_type: "main", fields: [{ key: "value", type: "string" }] } } }));
jest.mock("@/lib/apiClient", () => ({ apiClient: { request: (...args: unknown[]) => mockRequest(...args), put: (...args: unknown[]) => mockPut(...args), get: (...args: unknown[]) => mockGet(...args) } }));

import { useWorkflowPersistence, type LoadedWorkflow } from "@/hooks/useWorkflowPersistence";
import { useWorkflowVisibilitySave } from "@/hooks/useWorkflowVisibilitySave";

let persistence!: ReturnType<typeof useWorkflowPersistence>;
let edit!: React.Dispatch<React.SetStateAction<LoadedWorkflow | null>>;
let renderer: ReactTestRenderer;
let page: EventTarget & { visibilityState: string };
let originalDocument: PropertyDescriptor | undefined;

function Harness({ allowed = true }: { allowed?: boolean }) {
  const [document, setDocument] = useState<LoadedWorkflow | null>(null);
  edit = setDocument;
  persistence = useWorkflowPersistence({ projectId: null, workflowId: "workflow" });
  useWorkflowVisibilitySave({
    canSave: () => Boolean(allowed && document && !persistence.loading && !persistence.saving),
    hasUnsavedChanges: () => !!document && persistence.hasUnsavedChanges(document.nodes, document.edges, document.name, document.clusters),
    onSave: async () => {
      if (document) await persistence.saveWorkflow("workflow", document.name, document.nodes, document.edges, { clusters: document.clusters });
    },
  });
  return null;
}

async function visibility(state: string) {
  await act(async () => {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(async () => {
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  jest.clearAllMocks();
  mockBlockEmpty.mockResolvedValue(false);
  mockGet.mockResolvedValue({ ok: true, json: async () => ({}) });
  const row = {
    id: "workflow", name: "Workflow", project_id: null, revision: 1, is_active: false, node_clusters: [], edges: [],
    nodes: ["a", "b"].map(id => ({ id, displayName: id, name: "Example", node_type: "main", position: { x: 0, y: 0 }, values: { value: "original" } })),
  };
  mockRequest.mockResolvedValue({ ok: true, json: async () => ({ workflow: row }) });
  mockPut.mockImplementation(async (_path, payload) => ({ ok: true, json: async () => ({ workflow: { ...row, ...payload, revision: payload.expected_revision + 1 } }) }));
  await act(async () => { renderer = create(React.createElement(Harness)); });
  await act(async () => { edit(await persistence.loadWorkflow("workflow", () => undefined)); });
});

afterEach(() => {
  act(() => renderer.unmount());
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

test("switching away and back repeatedly does not save an unchanged loaded workflow", async () => {
  for (let i = 0; i < 3; i++) { await visibility("hidden"); await visibility("visible"); }
  expect(mockPut).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});

test("runtime outputs, selection and measured dimensions do not trigger background writes", async () => {
  act(() => edit(current => ({ ...current!, nodes: current!.nodes.map(node => ({ ...node, selected: true, measured: { width: 200, height: 100 }, data: { ...node.data, output: { status: "success", data: 42 }, isExecuting: true } })) })));
  await visibility("hidden");
  expect(mockPut).not.toHaveBeenCalled();
});

test.each(["name", "position", "values", "edges", "clusters"])("a real %s edit saves once and subsequent tab switches stay clean", async kind => {
  act(() => edit(current => {
    const doc = current!;
    if (kind === "name") return { ...doc, name: "Edited" };
    if (kind === "position") return { ...doc, nodes: doc.nodes.map(node => ({ ...node, position: { x: 25, y: 50 } })) };
    if (kind === "values") return { ...doc, nodes: doc.nodes.map(node => ({ ...node, data: { ...node.data, values: { value: "edited" } } })) };
    if (kind === "edges") return { ...doc, edges: [{ id: "edge", source: "a", target: "b" }] };
    return { ...doc, clusters: [{ id: "11111111-1111-4111-8111-111111111111", title: "Group", memberNodeIds: ["a", "b"] }] };
  }));
  await visibility("visible");
  expect(mockPut).not.toHaveBeenCalled();
  await visibility("hidden");
  expect(mockPut).toHaveBeenCalledTimes(1);
  expect(mockPut.mock.calls[0][1].expected_revision).toBe(1);
  expect(mockToast).toHaveBeenCalledWith({ title: "Success", description: "Workflow updated!" });
  await visibility("visible"); await visibility("hidden");
  expect(mockPut).toHaveBeenCalledTimes(1);
});

test("uses current eligibility after a rerender and keeps blocked drafts unsaved", async () => {
  act(() => { edit(current => ({ ...current!, name: "Edited" })); renderer.update(React.createElement(Harness, { allowed: false })); });
  await visibility("hidden");
  expect(mockPut).not.toHaveBeenCalled();
  act(() => renderer.update(React.createElement(Harness, { allowed: true })));
  await visibility("visible"); await visibility("hidden");
  expect(mockPut).toHaveBeenCalledTimes(1);
});

test("a failed save leaves the document dirty and can retry on a later hide", async () => {
  mockPut.mockResolvedValueOnce({ ok: false, status: 409 });
  act(() => edit(current => ({ ...current!, name: "Edited" })));
  await visibility("hidden");
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  await visibility("visible"); await visibility("hidden");
  expect(mockPut).toHaveBeenCalledTimes(2);
});

test("does not start another save while the previous request is pending", async () => {
  const respond = mockPut.getMockImplementation()!;
  let complete!: () => void;
  mockPut.mockImplementationOnce((...args) => new Promise(resolve => {
    complete = () => resolve(respond(...args));
  }));
  act(() => edit(current => ({ ...current!, name: "Edited" })));
  await visibility("hidden");
  expect(persistence.saving).toBe(true);
  await visibility("visible"); await visibility("hidden");
  expect(mockPut).toHaveBeenCalledTimes(1);
  await act(async () => complete());
  await visibility("visible"); await visibility("hidden");
  expect(mockPut).toHaveBeenCalledTimes(1);
});

test("removes the visibility listener on unmount", async () => {
  act(() => { edit(current => ({ ...current!, name: "Edited" })); renderer.unmount(); });
  await visibility("hidden");
  expect(mockPut).not.toHaveBeenCalled();
});
