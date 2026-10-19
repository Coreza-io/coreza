import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/jwtAuth";
import CredentialManager from "../utils/credentialManager";

const router = Router();
router.use(requireAuth);

const credentialsSchema = z.object({
  credential_name: z.string().trim().min(1, "Credential label is required").max(100),
  apiKey: z.string().trim().min(1, "OpenAI API key is required"),
});

// Keep each node's existing credential-list and execution namespace aligned.
const saveCredentials = (serviceType: string): RequestHandler => async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0].message });
  }

  try {
    const credential_id = await CredentialManager.saveCredentials(
      userId, serviceType, parsed.data.credential_name, { apiKey: parsed.data.apiKey },
    );
    return res.json({ success: true, credential_id });
  } catch {
    // Neither the supplied key nor encrypted credential material belongs in a response.
    return res.status(500).json({ success: false, error: "Failed to save OpenAI credentials" });
  }
};

router.post("/auth", saveCredentials("openai"));
router.post("/chat-model/auth", saveCredentials("openaichatmodel"));

export default router;
