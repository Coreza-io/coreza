import axios from "axios";
import { getDhanRestBaseUrl, resolveDhanEnvironment } from "./environment";

import { CredentialValidationError } from "../credentialValidation";

export function validateDhanCredentialFields(input: Record<string, unknown>) {
  const fields: Record<string, string> = {};
  const clientId = typeof input.client_id === "string" ? input.client_id.trim() : "";
  const token = typeof input.api_key === "string" ? input.api_key.trim() : typeof input.access_token === "string" ? input.access_token.trim() : "";
  if (!/^\d+$/.test(clientId)) fields.client_id = "Enter your numeric Dhan Client ID, not your email address.";
  if (!token || /\s/.test(token)) fields.api_key = "Enter the Dhan Access Token generated for this environment.";
  if (input.environment !== "live" && input.environment !== "sandbox") fields.environment = "Select Live or Sandbox explicitly.";
  // Decoding does not authenticate a JWT. Only an explicit numeric identity claim
  // is used to flag a typo; Dhan's read-only response validates the credential pair.
  if (token.length < 32768) {
    try {
      const claim = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      const id = claim.dhanClientId ?? claim.dhan_client_id ?? claim.client_id;
      const claimId = typeof id === "string" ? id : typeof id === "number" && Number.isSafeInteger(id) ? String(id) : "";
      if (/^\d+$/.test(claimId) && clientId && claimId !== clientId) fields.client_id = "Client ID does not match the ID in this access token.";
    } catch { /* Opaque tokens are validated by Dhan. */ }
  }
  if (Object.keys(fields).length) throw new CredentialValidationError(Object.values(fields)[0], 400, "DHAN_CREDENTIAL_FIELDS", fields);
  return { client_id: clientId, api_key: token, environment: resolveDhanEnvironment(input) };
}

export async function validateDhanCredentials(input: Record<string, unknown>) {
  const credentials = validateDhanCredentialFields(input);
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    response = await axios.get(`${getDhanRestBaseUrl(credentials.environment)}/fundlimit`, {
      headers: { "access-token": credentials.api_key, "client-id": credentials.client_id },
      signal: controller.signal, timeout: 8000, maxRedirects: 0, maxContentLength: 65536, validateStatus: () => true,
    });
  } catch (error) {
    // Never propagate an Axios error: it contains the authentication headers.
    const timeout = controller.signal.aborted || (axios.isAxiosError(error) && ["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? ""));
    throw new CredentialValidationError(timeout ? "Dhan credential validation timed out. Nothing was saved; retry Connect." : "Dhan credential validation is unavailable. Nothing was saved; retry Connect.", timeout ? 504 : 502, timeout ? "DHAN_CHECK_TIMEOUT" : "DHAN_CHECK_UNAVAILABLE");
  } finally { clearTimeout(timer); }
  if (response.status === 401 || response.data?.errorType === "Invalid_Authentication" || response.data?.errorCode === "DH-901") {
    throw new CredentialValidationError("Dhan rejected this Client ID and Access Token for the selected environment. Nothing was saved.", 401, "DHAN_CREDENTIAL_REJECTED");
  }
  if (response.status === 403) {
    throw new CredentialValidationError("Dhan refused the account check. Check permissions and environment before retrying Connect. Nothing was saved.", 403, "DHAN_CHECK_FORBIDDEN");
  }
  if (response.status < 200 || response.status >= 300 || response.data?.errorCode) {
    throw new CredentialValidationError("Dhan could not validate these credentials at the selected environment's account endpoint. Nothing was saved; retry Connect.", 502, "DHAN_CHECK_UNAVAILABLE");
  }
  const providerId = String(response.data?.dhanClientId ?? "");
  if (!/^\d+$/.test(providerId)) throw new CredentialValidationError("Dhan returned an unsupported credential-check response. Nothing was saved.", 502, "DHAN_CHECK_UNAVAILABLE");
  if (providerId !== credentials.client_id) throw new CredentialValidationError("Dhan authenticated a different Client ID. Nothing was saved.", 400, "DHAN_CLIENT_ID_MISMATCH", { client_id: "This Access Token belongs to a different Dhan Client ID." });
  return credentials;
}

export function validateDhanStreamCredentials(creds: Record<string, any>, environment: string) {
  const normalized = validateDhanCredentialFields(creds);
  if (normalized.environment !== environment) throw new CredentialValidationError("The selected environment does not match the saved Dhan credential.", 400, "DHAN_ENVIRONMENT_MISMATCH");
}
