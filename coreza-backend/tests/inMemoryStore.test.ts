import { InMemoryStore } from "../src/engine/InMemoryStore";

describe("InMemoryStore size accounting", () => {
  it("replaces a key without accumulating its previous size", () => {
    const store = new InMemoryStore("overwrite-test", 1);
    const metadata = { type: "custom" as const, source: "test" };
    store.set("state", { value: "same value" }, metadata);
    const initialSize = store.getStats().totalSizeBytes;

    for (let index = 0; index < 10; index += 1) {
      store.set("state", { value: "same value" }, metadata);
    }

    expect(store.getStats()).toMatchObject({ entryCount: 1, totalSizeBytes: initialSize });
  });
});
