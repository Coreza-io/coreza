import { randomUUID, createHash } from "crypto";
import { isDeepStrictEqual } from "util";
import { Mutex } from "async-mutex";
import { supabase } from "../config/supabase";
import { decimal } from "./decimal";
import { AccountingBook, AccountingEvent, AccountingStatus, AccountingTransition, BookScope, bookKey, eventFingerprint, eventKey, lifecycleEvent, lifecycleEventKey, reduceAccountingEvent } from "./accounting";

type PreparePublication = (transition: AccountingTransition) => () => void;

/** One session owns one allocation. SQL compares the owner token and revision;
 * a different process cannot silently adopt the book after restart. */
export class AccountingSession {
  private readonly owner = randomUUID();
  private readonly lock = new Mutex();
  private book?: AccountingBook;
  status: AccountingStatus = "initializing";
  reason?: string;
  private readonly db = supabase as any; // Internal deployment-only tables/RPCs.

  static async assertLegacySubmissionAllowed(userId: string, workflowId: string, activationId?: string, credentialId?: string): Promise<void> {
    if (process.env.PORTFOLIO_ACCOUNTING_V2_ENABLED !== "true" && process.env.PORTFOLIO_ACCOUNTING_V2_STORAGE_READY !== "true") return;
    const db = supabase as any;
    if (activationId) {
      const { data, error } = await db.from("portfolio_accounting_books").select("book_key")
        .eq("user_id", userId).eq("workflow_id", workflowId).eq("activation_id", activationId).limit(1).maybeSingle();
      if (error) throw error;
      if (data) throw new Error("Versioned accounting activation cannot submit through legacy broker/reservation adapters");
    }
    if (credentialId) {
      const { data, error } = await db.from("portfolio_accounting_books").select("book_key")
        .eq("user_id", userId).eq("active_account", true).eq("scope->>credentialId", credentialId).limit(1).maybeSingle();
      if (error) throw error;
      if (data) throw new Error("Credential has an exclusive versioned account claim; legacy submission is blocked");
    }
  }

  static async retainUnrecoveredEvent(userId: string, workflowId: string, activationId: string, event: Record<string, unknown>): Promise<void> {
    const db = supabase as any;
    const { data: book, error } = await db.from("portfolio_accounting_books").select("book_key")
      .eq("user_id", userId).eq("workflow_id", workflowId).eq("activation_id", activationId).maybeSingle();
    if (error || !book) throw new Error(error?.message ?? "Prior activation accounting checkpoint is unavailable; retain upstream delivery");
    await AccountingSession.writeEvidence(db, book.book_key, event, "Late owned event requires prior-activation journal recovery");
  }

  private static async writeEvidence(db: any, key: string, payload: unknown, reason: string): Promise<void> {
    const evidenceId = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const { error } = await db.from("portfolio_accounting_failures").upsert({ book_key: key,
      evidence_id: evidenceId, payload, reason }, { onConflict: "book_key,evidence_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  async rejectEvidence(payload: unknown, reason: string): Promise<void> {
    this.stop(reason);
    if (!this.book) throw new Error("Accounting checkpoint is unavailable; retain upstream delivery");
    await AccountingSession.writeEvidence(this.db, bookKey(this.book.scope), payload, this.reason!);
  }

  async open(initial: AccountingBook): Promise<AccountingBook> {
    return this.lock.runExclusive(async () => {
      if (this.status !== "initializing" && this.status !== "ready") throw new Error(this.reason ?? "Accounting recovery is required");
      if (this.book) {
        if (!isDeepStrictEqual(this.book.scope, initial.scope) || this.book.startingCash !== initial.startingCash) throw new Error("Accounting scope/allocation cannot change within an activation");
        return structuredClone(this.book);
      }
      try {
        const { data, error } = await this.db.rpc("portfolio_accounting_open", { p_key: bookKey(initial.scope), p_owner: this.owner, p_book: initial });
        if (error || !data || data.version !== 2 || !isDeepStrictEqual(data, initial)) throw new Error(error?.message ?? "Initial durable accounting checkpoint was not confirmed");
        this.book = data;
        if (this.status !== "initializing") throw new Error(this.reason ?? "Accounting initialization interrupted");
        this.status = "ready";
        return structuredClone(data);
      } catch (error: any) { this.stop(error?.message ?? "Accounting initialization failed"); throw error; }
    });
  }

  stop(reason: string): void {
    this.reason = String(reason || "Accounting reconciliation is required");
    this.status = this.reason.includes("unsupported_model") ? "unsupported_model" : "reconciliation_required";
  }
  getScope(): BookScope | undefined { return this.book ? { ...this.book.scope } : undefined; }

  private async commit(book: AccountingBook, transition: AccountingTransition, event: AccountingEvent, id: string, prepare: PreparePublication): Promise<AccountingTransition> {
    const publish = prepare(transition); // Validate the complete financial/view candidate before SQL.
    if (this.status !== "ready") throw new Error(this.reason ?? "Accounting acceptance interrupted");
    const { data, error } = await this.db.rpc("portfolio_accounting_commit", {
      p_key: bookKey(book.scope), p_owner: this.owner, p_expected: book.revision,
      p_book: transition.book, p_event_id: id, p_fingerprint: eventFingerprint(event), p_event: { input: event, execution: transition.execution ?? null },
    });
    if (error || !data || !isDeepStrictEqual(data, transition.book)) throw new Error(error?.message ?? "Accounting commit was not confirmed");
    this.book = data;
    if (this.status !== "ready") throw new Error(this.reason ?? "Accounting acceptance interrupted after commit");
    publish();
    return { ...transition, book: structuredClone(data) };
  }

  async accept(input: AccountingEvent, prepare: PreparePublication): Promise<AccountingTransition> {
    return this.lock.runExclusive(async () => {
      if (this.status !== "ready" || !this.book) throw new Error(this.reason ?? "Accounting book is not ready");
      const book = this.book;
      try {
        if (input.kind === "order_status" && (decimal(input.quantity).compare(0) !== 0 || decimal(input.fee).compare(0) !== 0)) throw new Error("Lifecycle events cannot contain economic changes");
        if (decimal(input.quantity).compare(0) === 0 && input.quoteNotional != null && decimal(input.quoteNotional).compare(0) !== 0) throw new Error("Notional without quantity requires reconciliation");
        // Zero-fill lifecycle updates must never consume a future execution's ID.
        let event = input.kind === "order_status" || (input.kind === "execution" && decimal(input.quantity).compare(0) === 0 && decimal(input.fee).compare(0) === 0)
          ? lifecycleEvent(input) : input;
        const id = event.kind === "execution" ? eventKey(book, event) : lifecycleEventKey(book, event);
        if (!id) throw new Error("Stable execution identity is required");
        // Check before reduction: an incremental replay could otherwise look like an oversell.
        const { data: existing, error: lookupError } = await this.db.from("portfolio_accounting_events").select("fingerprint").eq("book_key", bookKey(book.scope)).eq("event_id", id).maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) {
          if (existing.fingerprint !== eventFingerprint(event)) throw new Error("Immutable accounting event identity conflict");
          event = lifecycleEvent(event);
          const transition = reduceAccountingEvent(book, event);
          if (transition.book !== book) await this.commit(book, transition, event, lifecycleEventKey(book, event), prepare);
          return { book: structuredClone(this.book!), reason: "duplicate_execution" };
        }
        let transition = reduceAccountingEvent(book, event);
        if (transition.book === book) return { ...transition, book: structuredClone(book) };
        // An equal cumulative total can advance lifecycle without being an execution.
        if (!transition.execution) {
          event = lifecycleEvent(event);
          transition = reduceAccountingEvent(book, event);
        }
        return await this.commit(book, transition, event, transition.execution ? id : lifecycleEventKey(book, event), prepare);
      } catch (error: any) {
        try { await this.rejectEvidence(input, error?.message ?? "Accounting acceptance failed"); }
        catch (retentionError) { throw new AggregateError([error, retentionError], "Accounting failed and evidence retention was not confirmed; retain upstream delivery"); }
        throw error;
      }
    });
  }
}
