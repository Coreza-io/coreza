import { randomUUID, createHash } from "crypto";
import { Mutex } from "async-mutex";
import { supabase } from "../config/supabase";
import { AccountingBook, AccountingEvent, AccountingStatus, AccountingTransition, BookScope, bookKey, eventFingerprint, eventKey, reduceAccountingEvent } from "./accounting";

/** One session owns one allocation. SQL compares the owner token and revision;
 * a different process cannot silently adopt the book after restart. */
export class AccountingSession {
  private readonly owner = randomUUID();
  private readonly lock = new Mutex();
  private book?: AccountingBook;
  status: AccountingStatus = "initializing";
  reason?: string;
  private readonly db = supabase as any; // Internal deployment-only tables/RPCs.

  async open(initial: AccountingBook): Promise<AccountingBook> {
    return this.lock.runExclusive(async () => {
      if (this.status !== "initializing" && this.status !== "ready") throw new Error(this.reason ?? "Accounting recovery is required");
      if (this.book) {
        if (bookKey(this.book.scope) !== bookKey(initial.scope)) throw new Error("Accounting scope cannot change within an activation");
        return structuredClone(this.book);
      }
      const { data, error } = await this.db.rpc("portfolio_accounting_open", { p_key: bookKey(initial.scope), p_owner: this.owner, p_book: initial });
      if (error || !data || data.version !== 2) { this.stop(error?.message ?? "Missing durable accounting checkpoint"); throw new Error(this.reason); }
      this.book = data;
      this.status = "ready";
      return structuredClone(data);
    });
  }

  stop(reason: string): void {
    this.status = reason.includes("unsupported_model") ? "unsupported_model" : "reconciliation_required";
    this.reason = reason;
  }
  getScope(): BookScope | undefined { return this.book ? { ...this.book.scope } : undefined; }

  async accept(event: AccountingEvent, publish: (transition: AccountingTransition) => void): Promise<AccountingTransition> {
    return this.lock.runExclusive(async () => {
      if (this.status !== "ready" || !this.book) throw new Error(this.reason ?? "Accounting book is not ready");
      const book = this.book;
      const key = bookKey(book.scope);
      try {
        const economic = event.kind === "execution";
        const id = economic ? eventKey(book, event) : createHash("sha256").update(JSON.stringify([key, "status", event.orderId, event.status])).digest("hex");
        if (!id) throw new Error("Stable execution identity is required");
        // Check before reduction: an incremental replay could otherwise look like an oversell.
        const { data: existing, error: lookupError } = await this.db.from("portfolio_accounting_events").select("fingerprint,payload").eq("book_key", key).eq("event_id", id).maybeSingle();
        if (lookupError) throw lookupError;
        const fingerprint = eventFingerprint(event);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new Error("Immutable accounting event identity conflict");
          const lifecycle: AccountingEvent = { ...event, kind: "order_status", quantity: "0", fee: "0", price: undefined, quoteNotional: undefined, accountPosition: undefined };
          const candidate = reduceAccountingEvent(book, lifecycle);
          if (candidate.book !== book) {
            const lifecycleId = createHash("sha256").update(JSON.stringify([key, "status", event.orderId, event.status])).digest("hex");
            const { data, error } = await this.db.rpc("portfolio_accounting_commit", { p_key: key, p_owner: this.owner,
              p_expected: book.revision, p_book: candidate.book, p_event_id: lifecycleId, p_fingerprint: eventFingerprint(lifecycle), p_event: { input: lifecycle, execution: null } });
            if (error || !data || data.revision !== candidate.book.revision) throw new Error(error?.message ?? "Lifecycle commit was not confirmed");
            this.book = data;
            publish({ book: structuredClone(data), reason: "duplicate_execution" });
          }
          return { book: structuredClone(this.book!), reason: "duplicate_execution" };
        }
        const transition = reduceAccountingEvent(book, event);
        if (transition.book === book) return { ...transition, book: structuredClone(book) };
        const { data, error } = await this.db.rpc("portfolio_accounting_commit", {
          p_key: key, p_owner: this.owner, p_expected: book.revision,
          p_book: transition.book, p_event_id: id, p_fingerprint: fingerprint, p_event: { input: event, execution: transition.execution ?? null },
        });
        if (error || !data || data.revision !== transition.book.revision) throw new Error(error?.message ?? "Accounting commit was not confirmed");
        // SQL journal+checkpoint have committed. If publication fails, stop and recover;
        // never accept the source event by guessing whether SQL committed after a timeout.
        this.book = data;
        publish({ ...transition, book: structuredClone(data) });
        return { ...transition, book: structuredClone(data) };
      } catch (error: any) {
        this.stop(error?.message ?? "Accounting acceptance failed");
        const evidenceId = createHash("sha256").update(JSON.stringify(event)).digest("hex");
        // Rejected/unsupported broker facts are evidence, never clamped executions.
        // If SQL is unavailable the node still errors; upstream must retain delivery.
        await this.db.from("portfolio_accounting_failures").upsert({ book_key: key, evidence_id: evidenceId, payload: event, reason: this.reason }, { onConflict: "book_key,evidence_id", ignoreDuplicates: true });
        throw error;
      }
    });
  }
}
