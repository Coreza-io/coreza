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
// User-global data remains available for explicit read-only export; never merged into workflow $vars.
router.get("/legacy-global", async (req, res, next) => { try { res.json(await variableSnapshots.load(req.user!.id)); } catch (error) { next(error); } });
router.get("/snapshot", async (req, res, next) => {
  try {
    if (typeof req.query.workflowId !== "string") { res.status(400).json({ error: "Workflow ID required" }); return; }
    res.json(await variableSnapshots.load(req.user!.id, req.query.workflowId));
  } catch (error) { next(error); }
});
router.all("/", (req, res) => res.status(405).json({ error: "Author persistent variables through Edit Fields" }));
router.all("/:key", (req, res) => res.status(405).json({ error: "Author persistent variables through Edit Fields" }));
export default router;
