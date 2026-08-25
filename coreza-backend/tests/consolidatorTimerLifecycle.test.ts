import { WorkflowRunner } from "../src/services/WorkflowRunner";

describe("consolidator scan timer lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.ENABLE_CONSOLIDATOR_SCAN = "true";
    process.env.CONSOLIDATOR_SCAN_INTERVAL_MS = "1000";
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.ENABLE_CONSOLIDATOR_SCAN;
    delete process.env.CONSOLIDATOR_SCAN_INTERVAL_MS;
  });

  it("does not overlap, build a backlog, or schedule after stop", async () => {
    let finishScan: (() => void) | undefined;
    const scan = jest.fn(() => new Promise<void>((resolve) => { finishScan = resolve; }));
    const runner = Object.create(WorkflowRunner.prototype);
    Object.assign(runner, {
      running: true,
      workChain: Promise.resolve(),
      processConsolidatorScan: scan,
      enqueueWork: (work: () => Promise<void>) => work(),
    });

    Reflect.apply(Reflect.get(WorkflowRunner.prototype, "startConsolidatorScanTimer"), runner, []);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(scan).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(scan).toHaveBeenCalledTimes(1);

    finishScan?.();
    await Promise.resolve();
    await Promise.resolve();
    Object.assign(runner, { running: false });
    const timer = Reflect.get(runner, "scanTimer") as NodeJS.Timeout | undefined;
    if (timer) clearTimeout(timer);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
