import { Router } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { variableSnapshots, variablesEnabled } from "../variables/VariableSnapshotService";
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.user?.id) { res.status(401).json({ error: "Authentication required" }); return; }
  if (!variablesEnabled()) { res.status(404).json({ error: "Workflow variables are disabled" }); return; }
  next();
});
router.get("/", async (req, res, next) => { try { res.json(await variableSnapshots.load(req.user!.id)); } catch (error) { next(error); } });
router.get("/snapshot", async (req, res, next) => { try { res.json(await variableSnapshots.load(req.user!.id)); } catch (error) { next(error); } });
for (const [method, operation] of [["post", "create"], ["patch", "update"], ["delete", "delete"]] as const) {
  router[method](method === "post" ? "/" : "/:key", async (req, res, next) => {
    try {
      if (typeof req.body?.revision !== "string" || !/^\d+$/.test(req.body.revision)) { res.status(400).json({ error: "Expected revision required" }); return; }
      const key = method === "post" ? req.body.key : (req.params as Record<string, string>).key;
      res.json(await variableSnapshots.mutate(req.user!.id, req.body.revision, operation, key, req.body.value));
    } catch (error) { if (error instanceof Error && !(error as any).statusCode) Object.assign(error, { statusCode: 400 }); next(error); }
  });
}
export default router;
