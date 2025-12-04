/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Frontend Credential Manager - Delete Operations Only
 * All credential encryption/storage now handled by backend
 */

import { supabase } from "@/integrations/supabase/client";

export class CredentialManager {
  /**
   * Delete a credential
   */
  static async deleteCredential(
    userId: string,
    credentialId: string
  ): Promise<void> {
    if (!userId || !credentialId) {
      throw new Error("Missing required parameters");
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      throw new Error("Invalid credential ID format");
    }

    try {
      const { error } = await supabase
        .from("user_credentials")
        .delete()
        .eq("id", credentialId)
        .eq("user_id", userId);

      if (error) {
        console.error("Error deleting credential:", error);
        throw new Error(`Failed to delete credential: ${error.message}`);
      }

      console.log(`🗑️ Successfully deleted credential ${credentialId}`);
    } catch (error) {
      console.error("Error deleting credential:", error);
      throw error;
    }
  }
}

export default CredentialManager;
