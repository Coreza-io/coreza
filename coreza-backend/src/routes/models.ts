import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/jwtAuth";
import CredentialManager from "../utils/credentialManager";

const router = Router();
router.use(requireAuth);

const credentialsSchema = z.object({
  // Use the same service types as credential listing and model execution.
  serviceType: z.enum(["openai", "openaichatmodel", "geminichatmodel"]),
  credential_name: z.string().trim().min(1, "Credential label is required").max(100),
  apiKey: z.string().trim().min(1, "Model API key is required"),
});

router.post("/:serviceType/auth", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const parsed = credentialsSchema.safeParse({ ...req.body, serviceType: req.params.serviceType });
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0].message });
  }

  try {
    const credential_id = await CredentialManager.saveCredentials(
      userId, parsed.data.serviceType, parsed.data.credential_name, { apiKey: parsed.data.apiKey },
    );
    return res.json({ success: true, credential_id });
  } catch {
    // Neither the supplied key nor encrypted credential material belongs in a response.
    return res.status(500).json({ success: false, error: "Failed to save model credentials" });
  }
});

export default router;
