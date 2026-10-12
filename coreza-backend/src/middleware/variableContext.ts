import type { RequestHandler } from "express";
import { referencesVariables } from "../variables/contract";
import { variableSnapshots } from "../variables/VariableSnapshotService";
import { requireAuth } from "./jwtAuth";
// Manual typed Edit Fields requests keep expressions intact for the central evaluator.
// Other editor actions send already resolved parameters plus a revision, never a variable registry.
export const variableContext: RequestHandler = async (req, res, next) => {
  if (!referencesVariables(req.body) && req.body?.variableRevision === undefined) { next(); return; }
  if (!req.user?.id) {
    requireAuth(req, res, error => { if (error) next(error); else void variableContext(req, res, next); });
    return;
  }
  try {
    if (!req.user?.id) { res.status(401).json({ error: "Authentication required" }); return; }
    const snapshot = await variableSnapshots.load(req.user.id);
    if (req.body.variableRevision !== undefined && req.body.variableRevision !== snapshot.revision) {
      res.status(409).json({ error: "Variables changed during this execution; start a new run" }); return;
    }
    res.locals.variables = snapshot.values;
    next();
  } catch { res.status(503).json({ error: "Variable snapshot unavailable; execution cannot start" }); }
};
