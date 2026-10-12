import type { RequestHandler } from "express";
import { isTypedEditFieldRow } from "../nodes/logic/typedEditFieldRow";
import { referencesVariables } from "../variables/contract";
import { variableSnapshots } from "../variables/VariableSnapshotService";
import { requireAuth } from "./jwtAuth";
// Manual typed Edit Fields requests keep expressions intact for the central evaluator.
// Other editor actions send already resolved parameters plus a revision, never a variable registry.
export const variableContext: RequestHandler = async (req, res, next) => {
  const typedExpression = req.method === "POST" && /^\/comparator\/field\/?$/i.test(req.path)
    && Array.isArray(req.body?.fields)
    && req.body.fields.some((row: unknown) => isTypedEditFieldRow(row)
      && ((row.valueMode === "expression" && referencesVariables(row.value)) || req.body.persistent === true));
  // Generic actions already resolve expressions; raw request strings can be Fixed literals.
  if (!typedExpression && req.body?.variableRevision === undefined) { next(); return; }
  if (!req.user?.id) {
    requireAuth(req, res, error => { if (error) next(error); else void variableContext(req, res, next); });
    return;
  }
  try {
    if (!req.user?.id) { res.status(401).json({ error: "Authentication required" }); return; }
    if (typeof req.body?.workflowId !== "string") { res.status(400).json({ error: "Save the workflow before using persistent variables" }); return; }
    const snapshot = await variableSnapshots.load(req.user.id, req.body.workflowId);
    if (req.body.variableRevision !== undefined && req.body.variableRevision !== snapshot.revision) {
      res.status(409).json({ error: "Variables changed during this execution; start a new run" }); return;
    }
    res.locals.variableSnapshot = snapshot;
    res.locals.variables = snapshot.values;
    next();
  } catch (error) { res.status((error as any).statusCode ?? 503).json({ error: "Variable snapshot unavailable; execution cannot start" }); }
};
