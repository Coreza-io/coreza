import { runBar } from "../src/backtest/compiled/vm";
import { OpCode, type CompiledPlan, type Instruction } from "../src/backtest/compiled/types";
import type { WorkflowNode } from "../src/nodes/types";
import { TimeBarConsolidator, type ConsolidatorState } from "../src/engine/consolidation/TimeBarConsolidator";
import type { Bar } from "../src/backtest/simBroker/interfaces";
import { parseBar } from "../src/utils/barParser";

const node = (id: string): WorkflowNode => ({ id, name: id, node_type: "main", category: "test" });
const target = (instructionIndex: number, dependencyGroupIndex: number, inputSlot = 0) => ({
  instructionIndex,
  dependencyGroupIndex,
  inputSlot,
});

function plan(suppressDownstream: boolean): { plan: CompiledPlan; downstream: jest.Mock } {
  const downstream = jest.fn(() => ({ success: true, data: "visited" }));
  const instructions: Instruction[] = [
    {
      op: OpCode.EXEC, outSlot: 0, inputSlot: 2, node: node("source"), isAsyncNode: false,
      resolveParams: () => ({}), downstreamSlots: [target(1, 0)],
      exec: () => ({ success: true, data: "source", control: { suppressDownstream } }),
    },
    {
      op: OpCode.EXEC, outSlot: 1, inputSlot: 0, node: node("downstream"), isAsyncNode: false,
      resolveParams: () => ({}), downstreamSlots: [], exec: downstream,
    },
  ];
  const context = {
    isWarmingUp: false, nodeId: "", runId: "run", workflowId: "workflow", userId: "user", user_id: "user",
    nodes: instructions.map((item) => item.node), edges: [], dataContext: undefined, indicatorStateManager: undefined,
    executionMode: "backtest" as const, resolveNodeParameters: () => ({}), getAllNodeResults: () => ({}),
    getState: () => undefined, setState: () => undefined, checkCancellation: () => false,
  };
  return {
    downstream,
    plan: {
      barCount: 0, timingSampleRate: 0, instructionTimingMs: new Float64Array(2), instructionTimingCount: new Uint32Array(2),
      instructions, slots: new Array(3), active: new Uint8Array(2),
      activationCounts: new Uint32Array(2), requiredActivationCounts: new Uint32Array([1, 1]),
      satisfiedDependencyGroups: new Uint8Array(1),
      activeInputSlots: new Int32Array(2),
      entryIndices: [0], pinnedSlotEntries: [], inputSlot: 2,
      ctx: context, nodeIdToInstrIndex: new Map(), nodeResultsDirty: false, allNodeResultsCache: {},
      vmTimingMs: new Float64Array(3), vmTimingCount: new Uint32Array(3),
    },
  };
}

describe("compiled VM downstream suppression", () => {
  it.each([[true, 0], [false, 1]])("suppression=%s invokes downstream %i times", async (suppressed, calls) => {
    const fixture = plan(suppressed);
    await runBar(fixture.plan, {});
    expect(fixture.downstream).toHaveBeenCalledTimes(calls);
  });

  it("does not count duplicate activations from one branch as independent dependencies", async () => {
    const downstream = jest.fn(() => ({ success: true, data: {} }));
    const fixture = plan(false).plan;
    fixture.instructions = [
      { ...fixture.instructions[0], downstreamSlots: [target(3, 0)] },
      { ...fixture.instructions[0], node: node("same-branch"), downstreamSlots: [target(3, 0)] },
      {
        ...fixture.instructions[0], node: node("held-independent"),
        downstreamSlots: [target(3, 1)],
        exec: () => ({ success: true, data: null, control: { suppressDownstream: true } }),
      },
      { ...fixture.instructions[1], node: node("join"), exec: downstream },
    ];
    fixture.active = new Uint8Array(4);
    fixture.activationCounts = new Uint32Array(4);
    fixture.requiredActivationCounts = new Uint32Array([1, 1, 1, 2]);
    fixture.satisfiedDependencyGroups = new Uint8Array(2);
    fixture.activeInputSlots = new Int32Array(4);
    fixture.entryIndices = [0, 1, 2];
    fixture.instructionTimingMs = new Float64Array(4);
    fixture.instructionTimingCount = new Uint32Array(4);

    await runBar(fixture, {});

    expect(downstream).not.toHaveBeenCalled();
  });

  it("keeps the broker branch on source bars while releasing strategy nodes on completed bars", async () => {
    const broker = jest.fn(() => ({ success: true, data: {} }));
    const strategy = jest.fn((_node: WorkflowNode, _input: unknown) => ({ success: true, data: {} }));
    const consolidator = new TimeBarConsolidator({ sourceTimeframe: "1h", targetTimeframe: "4h" });
    let state: ConsolidatorState | undefined;
    const graphNodes = [node("onbar"), node("broker"), node("consolidator"), node("strategy")];
    const instructions: Instruction[] = [
      {
        op: OpCode.EXEC, outSlot: 0, inputSlot: 4, node: graphNodes[0], isAsyncNode: false,
        resolveParams: () => ({}), downstreamSlots: [target(1, 0, 0), target(2, 1, 0), target(3, 3, 0)], exec: (_node, input) => ({ success: true, data: input }),
      },
      {
        op: OpCode.EXEC, outSlot: 1, inputSlot: 0, node: graphNodes[1], isAsyncNode: false,
        resolveParams: () => ({}), downstreamSlots: [], exec: broker,
      },
      {
        op: OpCode.EXEC, outSlot: 2, inputSlot: 0, node: graphNodes[2], isAsyncNode: false,
        resolveParams: () => ({}), downstreamSlots: [target(3, 4, 2)],
        exec: (_node, input) => {
          const inputBar = parseBar(input.data);
          if (!inputBar) throw new Error("Expected a valid source bar");
          const result = consolidator.update(inputBar, state);
          state = result.state;
          return { success: true, data: result.emitted, control: { suppressDownstream: !result.emitted } };
        },
      },
      {
        op: OpCode.EXEC, outSlot: 3, inputSlot: 2, node: graphNodes[3], isAsyncNode: false,
        resolveParams: () => ({}), downstreamSlots: [], exec: strategy,
      },
    ];
    const fixture = plan(false).plan;
    fixture.instructions = instructions;
    fixture.slots = new Array(5);
    fixture.active = new Uint8Array(4);
    fixture.activationCounts = new Uint32Array(4);
    fixture.requiredActivationCounts = new Uint32Array([1, 1, 1, 2]);
    fixture.satisfiedDependencyGroups = new Uint8Array(5);
    fixture.activeInputSlots = new Int32Array(4);
    fixture.entryIndices = [0];
    fixture.inputSlot = 4;
    fixture.instructionTimingMs = new Float64Array(4);
    fixture.instructionTimingCount = new Uint32Array(4);
    fixture.ctx.nodes = graphNodes;

    for (let hour = 0; hour <= 4; hour += 1) {
      const bar: Bar = {
        timestamp: `2026-01-01T0${hour}:00:00.000Z`,
        open: hour,
        high: hour,
        low: hour,
        close: hour,
        volume: 1,
      };
      await runBar(fixture, bar);
    }

    expect(broker).toHaveBeenCalledTimes(5);
    expect(strategy).toHaveBeenCalledTimes(1);
    expect(strategy.mock.calls[0][1]).toMatchObject({
      data: { timestamp: "2026-01-01T00:00:00.000Z" },
    });
  });
});
