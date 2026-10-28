/** Run once after the coordinated reporting cutover; safe to resume on failure. */
import { supabase } from "../config/supabase";
import { LiveStrategiesRepository } from "../repositories/LiveStrategiesRepository";
import { reportingPages } from "../reporting/persistence";

async function main(): Promise<void> {
  const headers = await reportingPages(() => (supabase as any).from("live_strategies")
    .select("id").eq("mode", "live").or("metrics_updated_at.is.null,metrics_context->>finalization_pending.eq.true,metrics_context->>refresh_pending.eq.true").order("id"));
  let failures = 0;
  for (const header of headers) {
    try { await LiveStrategiesRepository.refresh(header.id, true); }
    catch (error) { failures++; console.error("Reporting summary requires retry", header.id, error); }
  }
  if (failures) throw new Error(`${failures} reporting summaries require retry`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
