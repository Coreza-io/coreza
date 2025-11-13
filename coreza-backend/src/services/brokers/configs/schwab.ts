import { RestConfig } from "../RestBrokerService";
import { BrokerInput } from "../types";
import axios from "axios";

interface SchwabCreds {
  app_key: string;
  app_secret: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
  account_number: string;
}

/**
 * Refresh Schwab access token if expired
 */
async function refreshTokenIfNeeded(creds: SchwabCreds): Promise<SchwabCreds> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = creds.token_expires_at || 0;

  // If token expires in less than 60 seconds, refresh it
  if (now >= expiresAt - 60) {
    console.log("🔄 [SCHWAB-BROKER] Access token expired, refreshing...");

    try {
      const credentials = `${creds.app_key}:${creds.app_secret}`;
      const encodedCredentials = Buffer.from(credentials).toString("base64");

      const response = await axios.post(
        "https://api.schwabapi.com/v1/oauth/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: creds.refresh_token,
        }),
        {
          headers: {
            Authorization: `Basic ${encodedCredentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const newTokens = response.data;
      const newExpiresAt = now + newTokens.expires_in;

      console.log("✅ [SCHWAB-BROKER] Token refreshed successfully");

      // Update credentials with new token
      const { supabase } = await import("../../config/supabase");
      const EnvelopeEncryptionUtil = (await import("../../utils/envelopeEncryption")).default;

      // Find and update the credential record
      const { data: credentialRecord } = await supabase
        .from("user_credentials")
        .select("*")
        .eq("service_type", "schwab")
        .eq("client_json->>access_token", creds.access_token)
        .single();

      if (credentialRecord) {
        const payload = {
          service_type: "schwab",
          name: credentialRecord.name,
          client: {
            app_key: creds.app_key,
            app_secret: creds.app_secret,
          },
          token: {
            access_token: newTokens.access_token,
            refresh_token: creds.refresh_token,
            token_expires_at: newExpiresAt,
          },
          meta: {
            account_number: creds.account_number,
            last_token_refresh: new Date().toISOString(),
          },
        };

        const encrypted = EnvelopeEncryptionUtil.encrypt(
          payload,
          credentialRecord.user_id
        );

        await supabase
          .from("user_credentials")
          .update({
            enc_payload: encrypted.encPayload,
            iv: encrypted.iv,
            auth_tag: encrypted.authTag,
            dek_wrapped: encrypted.dekWrapped,
            updated_at: new Date().toISOString(),
          })
          .eq("id", credentialRecord.id);
      }

      return {
        ...creds,
        access_token: newTokens.access_token,
        token_expires_at: newExpiresAt,
      };
    } catch (error: any) {
      console.error("❌ [SCHWAB-BROKER] Token refresh failed:", error);
      throw new Error(
        `Token refresh failed: ${error.message}. Please re-authenticate your Schwab account.`
      );
    }
  }

  return creds;
}

export const schwabConfig: RestConfig = {
  baseUrl: "https://api.schwabapi.com/trader/v1",

  makeAuthHeaders: async (creds: SchwabCreds) => {
    const refreshedCreds = await refreshTokenIfNeeded(creds);
    return {
      Authorization: `Bearer ${refreshedCreds.access_token}`,
      "Content-Type": "application/json",
    };
  },

  ops: {
    get_account: {
      method: "get",
      path: (input: BrokerInput, creds: SchwabCreds) =>
        `/accounts/${creds.account_number}`,
    },

    get_positions: {
      method: "get",
      path: (input: BrokerInput, creds: SchwabCreds) =>
        `/accounts/${creds.account_number}/positions`,
    },

    get_orders: {
      method: "get",
      path: (input: BrokerInput, creds: SchwabCreds) =>
        `/accounts/${creds.account_number}/orders`,
      makeParams: (input: BrokerInput) => ({
        maxResults: input.limit || 100,
        fromEnteredTime: input.start_date,
        toEnteredTime: input.end_date,
        status: input.status || "FILLED,CANCELED,REJECTED",
      }),
    },

    place_order: {
      method: "post",
      path: (input: BrokerInput, creds: SchwabCreds) =>
        `/accounts/${creds.account_number}/orders`,
      makeBody: (input: BrokerInput) => {
        const {
          symbol,
          instruction = "BUY",
          quantity,
          orderType = "MARKET",
          price,
          duration = "DAY",
          session = "NORMAL",
        } = input;

        if (!symbol) {
          throw new Error("symbol is required for place_order");
        }
        if (!quantity || quantity <= 0) {
          throw new Error("quantity must be greater than 0");
        }

        const orderPayload: any = {
          orderType: orderType.toUpperCase(),
          session: session.toUpperCase(),
          duration: duration.toUpperCase(),
          orderStrategyType: "SINGLE",
          orderLegCollection: [
            {
              instruction: instruction.toUpperCase(),
              quantity: Number(quantity),
              instrument: {
                symbol: symbol.toUpperCase(),
                assetType: "EQUITY",
              },
            },
          ],
        };

        // Add price for LIMIT and STOP_LIMIT orders
        if (
          (orderType === "LIMIT" || orderType === "STOP_LIMIT") &&
          price
        ) {
          orderPayload.price = Number(price);
        }

        return orderPayload;
      },
      transformResult: (raw: any) => {
        // Schwab returns order ID in Location header, but RestBrokerService doesn't expose headers
        // So we return the response as-is
        return {
          success: true,
          message: "Order placed successfully",
          orderId: raw.orderId || "Order submitted",
        };
      },
    },

    cancel_order: {
      method: "delete",
      path: (input: BrokerInput, creds: SchwabCreds) => {
        if (!input.order_id) {
          throw new Error("order_id is required for cancel_order");
        }
        return `/accounts/${creds.account_number}/orders/${input.order_id}`;
      },
    },
  },
};
