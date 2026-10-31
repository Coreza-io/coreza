import { AccountingBook, AccountingEvent, AccountingTransition, eventKey, eventFingerprint, lifecycleEvent, reduceAccountingEvent } from "./accounting";
import { decimal } from "./decimal";

/** Shadow/recovery calculation only. Never executes workflow nodes or submits orders.
 * Callers must establish provider history completeness and cursor boundaries first. */
export function replayAccountingEvents(checkpoint: AccountingBook, events: readonly AccountingEvent[]): AccountingTransition {
  let book = structuredClone(checkpoint);
  const seen = new Map<string, string>();
  for (const input of events) {
    if (decimal(input.quantity).compare(0) === 0 && input.quoteNotional != null && decimal(input.quoteNotional).compare(0) !== 0) throw new Error("Notional without quantity requires reconciliation");
    if (input.kind === "order_status" && (decimal(input.quantity).compare(0) !== 0 || decimal(input.fee).compare(0) !== 0)) throw new Error("Lifecycle events cannot contain economic changes");
    let event = input.kind === "order_status" || (input.kind === "execution" && decimal(input.quantity).compare(0) === 0 && decimal(input.fee).compare(0) === 0) ? lifecycleEvent(input) : input;
    const key = event.kind === "execution" ? eventKey(book, event) : undefined;
    if (key && seen.has(key)) {
      if (seen.get(key) !== eventFingerprint(event)) throw new Error("Conflicting replay identity");
      event = lifecycleEvent(event);
    }
    const transition = reduceAccountingEvent(book, event);
    if (transition.execution && key) seen.set(key, eventFingerprint(event));
    book = transition.book;
  }
  return { book };
}
