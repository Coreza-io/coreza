import fs from "node:fs";
import path from "node:path";
import { resolveManualExecution } from "@/nodes/manualExecution";
import type { NodeConfig } from "@/nodes/schemas/nodeSchema";

describe("manual execution capability", () => {
  const definitions = fs
    .readdirSync(path.join(process.cwd(), "src/nodes"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/nodes", file), "utf8")) as NodeConfig);

  it("requires every manifest definition to make an explicit decision", () => {
    expect(definitions).not.toHaveLength(0);
    for (const definition of definitions) {
      expect(["available", "attachment", "unsupported"]).toContain(definition.manualExecution);
    }
  });

  it("excludes attachments and Visualize while allowing intentional local actions", () => {
    for (const definition of definitions.filter(({ node_type }) => node_type === "sub")) {
      expect(resolveManualExecution(definition)).toEqual({ available: false, reason: "attachment" });
    }
    expect(resolveManualExecution(definitions.find(({ name }) => name === "Visualize")!))
      .toEqual({ available: false, reason: "unsupported" });
    for (const name of ["ChatInput", "InMemory", "Loop", "BacktestInit", "OnBar"]) {
      expect(resolveManualExecution(definitions.find((definition) => definition.name === name)!))
        .toEqual({ available: true });
    }
  });
});
