import { runBar } from "../src/backtest/compiled/vm";
import {
  BranchEnum,
  OpCode,
  type ActivationTarget,
  type CompiledPlan,
  type Instruction,
} from "../src/backtest/compiled/types";
import type { WorkflowNode } from "../src/nodes/types";

const node = (id: string, name = id): WorkflowNode => ({
  id,
  name,
  node_type: "main",
  category: "test",
});

const target = (instructionIndex: number, inputSlot: number): ActivationTarget => ({
  instructionIndex,
  dependencyGroupIndex: instructionIndex - 1,
  inputSlot,
});

function createPlan(instructions: Instruction[]): CompiledPlan {
  const context = {
    isWarmingUp: false,
    nodeId: "",
    runId: "run",
    workflowId: "workflow",
    userId: "user",
    user_id: "user",
    nodes: instructions.map((item) => item.node),
    edges: [],
    dataContext: undefined,
    indicatorStateManager: undefined,
    executionMode: "backtest" as const,
    resolveNodeParameters: () => ({}),
    getAllNodeResults: () => ({}),
    getState: () => undefined,
    setState: () => undefined,
    checkCancellation: () => false,
  };
  const size = instructions.length;
  return {
    barCount: 0,
    timingSampleRate: 0,
    instructionTimingMs: new Float64Array(size),
    instructionTimingCount: new Uint32Array(size),
    instructions,
    slots: new Array(size + 1),
    active: new Uint8Array(size),
    activationCounts: new Uint32Array(size),
    satisfiedDependencyGroups: new Uint8Array(Math.max(0, size - 1)),
    requiredActivationCounts: Uint32Array.from({ length: size }, () => 1),
    activeInputSlots: new Int32Array(size),
    entryIndices: [0],
    pinnedSlotEntries: [],
    inputSlot: size,
    ctx: context,
    nodeIdToInstrIndex: new Map(),
    nodeResultsDirty: false,
    allNodeResultsCache: {},
    vmTimingMs: new Float64Array(3),
    vmTimingCount: new Uint32Array(3),
  };
}

describe("compiled VM successful-result propagation", () => {
  it("activates downstream instructions when emitted is false", async () => {
    const downstream = jest.fn(() => ({ success: true, data: "visited" }));
    const instructions: Instruction[] = [
      {
        op: OpCode.EXEC,
        outSlot: 0,
        inputSlot: 2,
        node: node("consolidator"),
        isAsyncNode: false,
        resolveParams: () => ({}),
        downstreamSlots: [target(1, 0)],
        exec: () => ({ success: true, data: { emitted: false, workingBar: {} } }),
      },
      {
        op: OpCode.EXEC,
        outSlot: 1,
        inputSlot: 0,
        node: node("downstream"),
        isAsyncNode: false,
        resolveParams: () => ({}),
        downstreamSlots: [],
        exec: downstream,
      },
    ];

    await runBar(createPlan(instructions), {});

    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, 1, 0],
    [false, 0, 1],
  ])("routes emitted=%s through the matching If branch", async (emitted, trueCalls, falseCalls) => {
    const trueSink = jest.fn(() => ({ success: true, data: {} }));
    const falseSink = jest.fn(() => ({ success: true, data: {} }));
    const branchTargets: ActivationTarget[][] = [[], [], [], []];
    branchTargets[BranchEnum.TRUE] = [target(2, 1)];
    branchTargets[BranchEnum.FALSE] = [target(3, 1)];
    const instructions: Instruction[] = [
      {
        op: OpCode.EXEC,
        outSlot: 0,
        inputSlot: 4,
        node: node("consolidator"),
        isAsyncNode: false,
        resolveParams: () => ({}),
        downstreamSlots: [target(1, 0)],
        exec: () => ({ success: true, data: { emitted } }),
      },
      {
        op: OpCode.BRANCH,
        outSlot: 1,
        inputSlot: 0,
        node: node("if", "If"),
        isAsyncNode: false,
        resolveParams: () => ({}),
        downstreamSlots: [],
        branchTargets,
        exec: (_node, input) => ({ success: true, data: input.data.emitted }),
      },
      {
        op: OpCode.EXEC,
        outSlot: 2,
        inputSlot: 1,
        node: node("true-sink"),
        isAsyncNode: false,
        resolveParams: () => ({}),
        downstreamSlots: [],
        exec: trueSink,
      },
      {
        op: OpCode.EXEC,
        outSlot: 3,
        inputSlot: 1,
        node: node("false-sink"),
        isAsyncNode: false,
        resolveParams: () => ({}),
        downstreamSlots: [],
        exec: falseSink,
      },
    ];

    await runBar(createPlan(instructions), {});

    expect(trueSink).toHaveBeenCalledTimes(trueCalls);
    expect(falseSink).toHaveBeenCalledTimes(falseCalls);
  });
});
