import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useWorkflowMutationGuard } from "@/hooks/useWorkflowMutationGuard";
import { acquireEditorExecutionLock, releaseEditorExecutionLock } from "@/services/editorNodeExecution";

it("reads the live execution lock before a paste commit, including after Stop until settlement", () => {
  const activity = {clusterMove:{current:null as unknown},nodeDrag:{current:null as unknown},selectionDrag:{current:false},connectionDrag:{current:false}};
  let guard!: ReturnType<typeof useWorkflowMutationGuard>;
  function Harness() {
    guard = useWorkflowMutationGuard({workflowSessionId:"paste-guard",loading:false,hasInvalidMetadata:false,...activity});
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {renderer=create(React.createElement(Harness));});
  const commit = jest.fn();
  const paste = () => { if (guard()) commit(); };
  const lock = acquireEditorExecutionLock("paste-guard",{kind:"cluster",id:"outer"})!;
  try {
    paste();
    // Aborting an action does not release ownership; only settlement does.
    paste();
    expect(commit).not.toHaveBeenCalled();
  } finally {releaseEditorExecutionLock("paste-guard",lock);}
  paste();
  expect(commit).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it("blocks every active canvas drag, loading, invalid metadata, and old-session callbacks", () => {
  const activity = {clusterMove:{current:null as unknown},nodeDrag:{current:null as unknown},selectionDrag:{current:false},connectionDrag:{current:false}};
  let guard!: ReturnType<typeof useWorkflowMutationGuard>;
  function Harness({session="first",loading=false,invalid=false}) {
    guard = useWorkflowMutationGuard({workflowSessionId:session,loading,hasInvalidMetadata:invalid,...activity});
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {renderer=create(React.createElement(Harness));});
  for (const ref of Object.values(activity)) {
    ref.current = true;
    expect(guard()).toBe(false);
    ref.current = null as never;
  }
  activity.connectionDrag.current = true;
  expect(guard({allowConnectionDrag:true})).toBe(true);
  activity.clusterMove.current = {};
  expect(guard({allowConnectionDrag:true})).toBe(false);
  activity.clusterMove.current = null;
  activity.connectionDrag.current = false;
  const beforeLoading = guard;
  act(() => renderer.update(React.createElement(Harness,{loading:true})));
  expect(guard()).toBe(false);
  expect(beforeLoading()).toBe(false);
  act(() => renderer.update(React.createElement(Harness,{invalid:true})));
  expect(guard()).toBe(false);
  expect(guard({allowInvalidMetadata:true})).toBe(true);
  const stale = guard;
  act(() => renderer.update(React.createElement(Harness,{session:"next"})));
  expect(stale({allowInvalidMetadata:true})).toBe(false);
  expect(guard()).toBe(true);
  act(() => renderer.unmount());
  expect(guard()).toBe(false);
});
