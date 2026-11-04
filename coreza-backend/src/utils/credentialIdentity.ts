import { createHash } from "crypto";

export function getCredentialRevision(creds: Record<string, any>): string {
  return typeof creds._credentialRevision === "string" ? creds._credentialRevision : createHash("sha256")
    .update(JSON.stringify(creds)).digest("hex");
}
