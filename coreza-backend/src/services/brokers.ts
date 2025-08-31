// New registry-based broker service - replaces the old static BrokerService
import { getBrokerService } from "./brokers/registry";
import { supabase } from "../config/supabase";

export class BrokerService {
  static async execute(broker: string, input: any) {
    const brokerService = getBrokerService(broker);
    if (!brokerService) {
      return {
        success: false,
        error: `Unsupported broker: ${broker}`,
      };
    }
    return brokerService.execute(input);
  }

  static async getCredentialsList(
    broker: string,
    userId: string
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("user_credentials")
        .select("id, name, created_at")
        .eq("user_id", userId)
        .eq("service_type", broker);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error(`Error fetching ${broker} credentials:`, error);
      return [];
    }
  }

  static async saveCredentials(
    broker: string,
    userId: string,
    credentialName: string,
    credentials: any
  ): Promise<any> {
    try {
      // Check if credential with same name already exists
      const { data: existing } = await supabase
        .from("user_credentials")
        .select("id")
        .eq("user_id", userId)
        .eq("service_type", broker)
        .eq("credential_name", credentialName)
        .single();

      if (existing) {
        // Update existing credential
        const { data, error } = await supabase
          .from("user_credentials")
          .update({
            credentials,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (error) throw error;
        return { success: true, data };
      } else {
        // Create new credential
        const { data, error } = await supabase
          .from("user_credentials")
          .insert({
            user_id: userId,
            service_type: broker,
            credential_name: credentialName,
            credentials,
          })
          .select()
          .single();

        if (error) throw error;
        return { success: true, data };
      }
    } catch (error) {
      console.error(`Error saving ${broker} credentials:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// Note: initializeBrokerServices should be imported directly from './brokers/index'
// to avoid circular imports. Other functions are re-exported for convenience.
export { getBrokerService, getAllRegisteredBrokers } from "./brokers/registry";
export { BrokerInput, BrokerResult, IBrokerService } from "./brokers/types";
