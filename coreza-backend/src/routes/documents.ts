import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { DocumentExecutor } from "../nodes/executors/DocumentExecutor";

const router = express.Router();
const executor = new DocumentExecutor();

router.use(requireAuth);

router.post("/extract", async (req, res) => {
  const result = await executor.execute(
    { id: "documents-extract-route", name: "DocumentExtract", node_type: "main", category: "Document", values: req.body },
    {},
  );

  if (result.success) {
    res.json(result.data);
    return;
  }

  res.status(400).json({ error: "Document extraction failed", message: result.error });
});

export default router;
