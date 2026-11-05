import { Router } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { variableSnapshots } from "../variables/VariableSnapshotService";
import { editorVariables } from "../variables/EditorVariableService";
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.user?.id) { res.status(401).json({ error: "Authentication required" }); return; }
  next();
});
// Legacy data is export-only and is never merged into an active scope.
router.get("/", async (req, res, next) => { try { res.json(await variableSnapshots.load(req.user!.id)); } catch (error) { next(error); } });
router.get("/legacy-global", async (req, res, next) => { try { res.json(await variableSnapshots.load(req.user!.id)); } catch (error) { next(error); } });
router.get("/snapshot", async (req, res, next) => {
  try {
    const { scope, workflowId } = await editorVariables.authorize(req.user!.id, req.query.workflowId,
      typeof req.query.scope === "string" ? JSON.parse(req.query.scope) : undefined);
    res.json(await editorVariables.read(req.user!.id, workflowId, scope));
  } catch (error) { next(error); }
});
for (const operation of ["open", "touch", "close"] as const) {
  router.post(`/scope/${operation}`, async (req, res, next) => {
    try {
      const { scope, workflowId } = await editorVariables.authorize(req.user!.id, req.body.workflowId, req.body.variableScope);
      const snapshot = await editorVariables[operation](req.user!.id, workflowId, scope);
      res.json(snapshot ?? { closed: true });
    } catch (error) { next(error); }
  });
}
router.all("/", (req, res) => res.status(405).json({ error: "Author variables through Edit Fields" }));
router.all("/:key", (req, res) => res.status(405).json({ error: "Author variables through Edit Fields" }));
export default router;
