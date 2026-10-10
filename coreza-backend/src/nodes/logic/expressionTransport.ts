import { encodeExpressionJson } from "./boundedJson";
import { evaluateEditTemplate, type CompiledEditTemplate } from "./editTemplate";
import { ExpressionBudget, ExpressionError, type ExpressionContext } from "./safeExpression";

type Value = null | string | number | boolean | { ref: number } | { undefined: true } | { number: string };
type Entry = [string, Value];
interface Packet {
  roots: { json: Value; nodes: Value; outputs: Value };
  objects: { array: boolean; length: number; entries: Entry[] }[];
}

/** Capture only evaluated reads. Array lengths/indices and shared identity survive HTTP;
 * unread history slots never enter JSON.stringify or invoke their serializers. */
export function prepareExpressionTransport(compiled: CompiledEditTemplate, context: ExpressionContext): Packet {
  const reads = new WeakMap<object, Set<string>>();
  const proxies = new WeakMap<object, object>();
  const budget = new ExpressionBudget();
  const remember = (object: object, key: string | symbol) => {
    if (typeof key !== "string") return;
    let keys = reads.get(object);
    if (!keys) { keys = new Set(); reads.set(object, keys); }
    if (!keys.has(key)) { budget.copy(1, 0); keys.add(key); }
  };
  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const cached = proxies.get(value); if (cached) return cached;
    // A shadow target also supports frozen source objects without violating proxy invariants.
    const shadow = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    const proxy = new Proxy(shadow, {
      get: (_, key) => { remember(value, key); return wrap(Reflect.get(value, key)); },
      getOwnPropertyDescriptor: (_, key) => {
        remember(value, key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) return undefined;
        if (Array.isArray(value) && key === "length") return { ...Object.getOwnPropertyDescriptor(shadow, key)!, value: value.length };
        return "value" in descriptor
          ? { ...descriptor, configurable: true, value: wrap(descriptor.value) }
          : { ...descriptor, configurable: true };
      },
      ownKeys: () => { const keys = Reflect.ownKeys(value); for (const key of keys) remember(value, key); return keys; },
    });
    proxies.set(value, proxy);
    return proxy;
  };
  evaluateEditTemplate(compiled, {
    ...context,
    $json: wrap(context.$json),
    $nodes: wrap(context.$nodes) as ExpressionContext["$nodes"],
    expressionOutputs: wrap(context.expressionOutputs) as ExpressionContext["expressionOutputs"],
  });
  const objects: Packet["objects"] = [], ids = new WeakMap<object, number>();
  const encode = (value: unknown): Value => {
    budget.step(0);
    if (value === undefined) return { undefined: true };
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) return { number: String(value === 0 ? "-0" : value) };
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as Value;
    if (typeof value !== "object") throw new ExpressionError("Unsupported expression transport value", 0, "serialization");
    const cached = ids.get(value); if (cached !== undefined) return { ref: cached };
    const id = objects.length;
    budget.copy(1, 0); ids.set(value, id);
    const object = { array: Array.isArray(value), length: Array.isArray(value) ? value.length : 0, entries: [] as Entry[] };
    objects.push(object);
    for (const key of reads.get(value) ?? []) {
      if (object.array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (!("value" in descriptor)) throw new ExpressionError("Accessor expression transport property", 0, "serialization", key);
      budget.copy(1, 0); object.entries.push([key, encode(descriptor.value)]);
    }
    return { ref: id };
  };
  const packet: Packet = { roots: { json: encode(context.$json), nodes: encode(context.$nodes), outputs: encode(context.expressionOutputs) }, objects };
  encodeExpressionJson(packet, budget);
  return packet;
}

/** Treat the packet only as calculation input. Validate bounds before allocating,
 * then let the ordinary evaluator enforce references, arguments and output safety. */
export function restoreExpressionTransport(input: unknown): Pick<ExpressionContext, "$json" | "$nodes" | "expressionOutputs"> {
  const budget = new ExpressionBudget();
  encodeExpressionJson(input, budget);
  const fail = (): never => { throw new ExpressionError("Invalid expression transport context", 0, "serialization"); };
  const packet = input as Packet;
  if (!packet || !packet.roots || !Array.isArray(packet.objects)) return fail();
  budget.copy(packet.objects.length, 0);
  const objects = packet.objects.map(object => {
    if (!object || typeof object.array !== "boolean" || !Number.isSafeInteger(object.length) || object.length < 0 || object.length > 0xffffffff || !Array.isArray(object.entries)) return fail();
    budget.copy(object.entries.length, 0);
    if (!object.array) return Object.create(null);
    // A sparse view preserves length without allocating an unread history prefix.
    return new Proxy([], {
      get: (target, key) => key === "length" ? object.length : Reflect.get(target, key),
      getOwnPropertyDescriptor: (target, key) => key === "length"
        ? { ...Object.getOwnPropertyDescriptor(target, key)!, value: object.length }
        : Object.getOwnPropertyDescriptor(target, key),
    });
  });
  const decode = (value: Value): unknown => {
    budget.step(0);
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) return fail();
    if ("undefined" in value && value.undefined === true) return undefined;
    if ("number" in value) {
      if (!["NaN", "Infinity", "-Infinity", "-0"].includes(value.number)) return fail();
      return Number(value.number);
    }
    if (!("ref" in value) || !Number.isInteger(value.ref) || value.ref < 0 || value.ref >= objects.length) return fail();
    return objects[value.ref];
  };
  packet.objects.forEach((object, index) => {
    const seen = new Set<string>();
    for (const entry of object.entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || seen.has(entry[0]) || (object.array && entry[0] === "length")) return fail();
      seen.add(entry[0]);
      if (object.array && /^(0|[1-9]\d*)$/.test(entry[0]) && Number(entry[0]) >= object.length) return fail();
      Object.defineProperty(objects[index], entry[0], { value: decode(entry[1]), enumerable: true, configurable: true, writable: true });
    }
  });
  const json = decode(packet.roots.json), nodes = decode(packet.roots.nodes), outputs = decode(packet.roots.outputs);
  if ((nodes !== undefined && (!nodes || typeof nodes !== "object" || Array.isArray(nodes))) || (outputs !== undefined && (!outputs || typeof outputs !== "object" || Array.isArray(outputs)))) return fail();
  return { $json: json, $nodes: nodes as ExpressionContext["$nodes"], expressionOutputs: outputs as ExpressionContext["expressionOutputs"] };
}
