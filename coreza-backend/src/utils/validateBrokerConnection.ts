import axios from "axios";
import { getBrokerConfig } from "../brokers";
import { CredentialValidator } from "./credentialValidator";

/** Validate submitted API keys without reading or modifying stored credentials. */
export async function validateBrokerConnection(
  broker: string,
  credentials: Record<string, any>,
): Promise<string | undefined> {
  const environments: Record<string, string[]> = {
    dhan: ["live", "sandbox"],
    alpaca: ["paper", "live"],
    binance: ["testnet", "live"],
  };
  if (!Object.hasOwn(environments, broker)) return "Unsupported API-key broker";
  const validation = CredentialValidator.validateCredentials(broker, credentials);
  if (!validation.isValid) return validation.errors.join(". ");
  if (Object.values(credentials).some(value => typeof value === "string" && !value.trim())) {
    return "Credential fields must not be blank";
  }
  if (credentials.environment !== undefined && !environments[broker].includes(credentials.environment)) {
    return "Select a supported broker environment";
  }
  const markets = broker === "binance" ? ["spot", "futures"]
    : broker === "alpaca" ? ["stock", "crypto"] : ["equity"];
  for (const key of ["marketType", "asset_type", "assetType"]) {
    if (credentials[key] !== undefined && !markets.includes(credentials[key])) {
      return "Select a supported broker market";
    }
  }
  const selections = [credentials.marketType, credentials.asset_type, credentials.assetType]
    .filter(value => value !== undefined);
  if (new Set(selections).size > 1) return "Broker market selections must agree";

  const config = getBrokerConfig(broker)!;
  const operation = config.operations.get_account;
  const input = { operation: "get_account", environment: credentials.environment,
    marketType: selections[0] ?? (broker === "binance" ? "spot" : undefined) };
  try {
    const baseUrl = typeof config.baseUrl === "function"
      ? config.baseUrl(credentials, input) : config.baseUrl;
    const path = typeof operation.path === "function"
      ? operation.path(input, credentials) : operation.path;
    const response = await axios.request({
      method: operation.method,
      url: `${baseUrl}${path}`,
      headers: await config.makeAuthHeaders(credentials),
      params: operation.makeParams?.(input, credentials),
      timeout: 8000,
      maxRedirects: 0,
    });
    if ((broker === "alpaca" && typeof response.data?.id !== "string") ||
        (broker === "binance" && !Array.isArray(response.data?.balances) && !Array.isArray(response.data?.assets))) {
      return "Credential validation could not be completed. Please retry.";
    }
    if (broker === "dhan" && (
      response.data?.dhanClientId == null ||
      String(response.data.dhanClientId) !== credentials.client_id
    )) {
      return "Dhan account identity could not be verified. Check that the access token belongs to the submitted client ID.";
    }
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 400 || status === 401 || status === 403) {
      return "Broker rejected these credentials. Check the keys and selected environment and market.";
    }
    return "Credential validation could not be completed. Please retry.";
  }
}
