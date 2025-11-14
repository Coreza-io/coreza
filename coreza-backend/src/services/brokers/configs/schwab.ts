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
  baseUrl: (creds: SchwabCreds, input?: BrokerInput) => {
    // Market data operations use marketdata endpoint
    const marketDataOps = ["get_quotes", "get_price_history"];
    
    if (input?.operation && marketDataOps.includes(input.operation)) {
      return "https://api.schwabapi.com/marketdata/v1";
    }
    
    // Trading operations use trader endpoint
    return "https://api.schwabapi.com/trader/v1";
  },

  makeAuthHeaders: async (creds: SchwabCreds) => {
    const refreshedCreds = await refreshTokenIfNeeded(creds);
    return {
      Authorization: `Bearer ${refreshedCreds.access_token}`,
      "Content-Type": "application/json",
    };
  },

  ops: {
    get_account_numbers: {
      method: "get",
      path: `/accounts/accountNumbers`,
      transformResult: (raw: any) => {
        // Transform to format suitable for dropdown
        if (!raw || !Array.isArray(raw)) {
          return { accounts: [] };
        }
        return {
          accounts: raw.map((acc: any) => ({
            id: acc.hashValue,
            name: `Account ${acc.accountNumber}`,
            accountNumber: acc.accountNumber,
            hashValue: acc.hashValue,
          })),
        };
      },
    },

    get_account: {
      method: "get",
      path: (input: BrokerInput, creds: SchwabCreds) => {
        const accountHash = input.accountHash || input.account_hash;
        if (!accountHash) {
          throw new Error("accountHash is required. Please select an account.");
        }
        return `/accounts/${accountHash}`;
      },
      makeParams: (input: BrokerInput) => ({
        fields: input.fields || "positions", // Include positions by default
      }),
    },

    get_positions: {
      method: "get",
      path: (input: BrokerInput, creds: SchwabCreds) => {
        const accountHash = input.accountHash || input.account_hash;
        if (!accountHash) {
          throw new Error("accountHash is required. Please select an account.");
        }
        return `/accounts/${accountHash}`;
      },
      makeParams: (input: BrokerInput) => ({
        fields: "positions",
      }),
    },

    get_orders: {
      method: "get",
      path: (input: BrokerInput, creds: SchwabCreds) => {
        const accountHash = input.accountHash || input.account_hash;
        if (!accountHash) {
          throw new Error("accountHash is required. Please select an account.");
        }
        return `/accounts/${accountHash}/orders`;
      },
      makeParams: (input: BrokerInput) => ({
        maxResults: input.limit || 100,
        fromEnteredTime: input.start_date,
        toEnteredTime: input.end_date,
        status: input.status || "FILLED,CANCELED,REJECTED",
      }),
    },

    place_order: {
      method: "post",
      path: (input: BrokerInput, creds: SchwabCreds) => {
        const accountHash = input.accountHash || input.account_hash;
        if (!accountHash) {
          throw new Error("accountHash is required. Please select an account.");
        }
        return `/accounts/${accountHash}/orders`;
      },
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
        const accountHash = input.accountHash || input.account_hash;
        if (!accountHash) {
          throw new Error("accountHash is required. Please select an account.");
        }
        if (!input.order_id) {
          throw new Error("order_id is required for cancel_order");
        }
        return `/accounts/${accountHash}/orders/${input.order_id}`;
      },
    },

    get_quotes: {
      method: "get",
      path: "/quotes",
      makeParams: (input: BrokerInput) => {
        if (!input.symbols) {
          throw new Error("symbols parameter is required for get_quotes");
        }
        return {
          symbols: input.symbols,
          fields: input.fields || "quote,fundamental",
          indicative: "false"
        };
      },
      transformResult: (raw: any) => {
        // Transform object format to array
        const quotes = Object.entries(raw).map(([symbol, data]: [string, any]) => ({
          symbol,
          ...(data.quote || {}),
          fundamental: data.fundamental,
          reference: data.reference
        }));
        return { quotes, count: quotes.length };
      },
    },

    get_price_history: {
      method: "get",
      path: (input: BrokerInput) => {
        if (!input.symbol) {
          throw new Error("symbol parameter is required for get_price_history");
        }
        return `/pricehistory`;
      },
      makeParams: (input: BrokerInput) => {
        return {
          symbol: input.symbol,
          periodType: input.periodType || "day",
          period: input.period || "10",
          frequencyType: input.frequencyType || "minute",
          frequency: input.frequency || "1",
          needExtendedHoursData: input.needExtendedHoursData || "false"
        };
      },
      transformResult: (raw: any) => ({
        symbol: raw.symbol,
        candles: raw.candles || [],
        empty: raw.empty || false
      }),
    },
  },
};
