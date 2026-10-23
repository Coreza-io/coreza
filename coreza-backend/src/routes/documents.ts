import { toPublicNodeResult } from "../contracts/nodeResult";
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

  if (result.status !== "error") {
    res.json(toPublicNodeResult(result));
    return;
  }

  res.status(400).json(toPublicNodeResult(result));
});

export default router;
