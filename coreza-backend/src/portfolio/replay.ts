import { AccountingBook, AccountingEvent, AccountingTransition, eventKey, eventFingerprint, reduceAccountingEvent } from "./accounting";

/** Shadow/recovery calculation only. Never executes workflow nodes or submits orders.
 * Callers must establish provider history completeness and cursor boundaries first. */
export function replayAccountingEvents(checkpoint: AccountingBook, events: readonly AccountingEvent[]): AccountingTransition {
  let book = structuredClone(checkpoint);
  const seen = new Map<string, string>();
  for (const event of events) {
    const key = event.kind === "execution" ? eventKey(book, event) : undefined;
    if (key) {
      const fingerprint = eventFingerprint(event);
      if (seen.has(key)) {
        if (seen.get(key) !== fingerprint) throw new Error("Conflicting replay identity");
        // Lifecycle can still advance independently of the duplicate execution.
        book = reduceAccountingEvent(book, { ...event, kind: "order_status", quantity: "0", fee: "0", price: undefined, quoteNotional: undefined, accountPosition: undefined }).book;
        continue;
      }
      seen.set(key, fingerprint);
    }
    book = reduceAccountingEvent(book, event).book;
  }
  return { book };
}
