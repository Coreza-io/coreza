/**
 * Credential Manager for secure handling of encrypted user credentials
 * Updated to work with enhanced envelope encryption backend
 */

import { supabase } from '@/integrations/supabase/client';

export interface UserCredential {
  id: string;
  name: string;
  service_type: string;
  created_at: string;
  updated_at: string;
}

export interface DecryptedCredential extends UserCredential {
  credentials: Record<string, any>;
}

class CredentialManager {
  /**
   * Retrieve and decrypt user credentials for a specific service using enhanced backend
   */
  static async getCredentials(
    userId: string, 
    serviceType: string, 
    credentialName?: string
  ): Promise<DecryptedCredential[]> {
    try {
      // Use enhanced credentials API
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      let url = `${backendUrl}/api/enhanced-credentials?service_type=${serviceType}`;
      
      if (credentialName) {
        url += `&name=${encodeURIComponent(credentialName)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'user-id': userId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch credentials: ${response.statusText}`);
      }

      const data = await response.json();
      return data.credentials || [];

    } catch (error) {
      console.error('Error in getCredentials:', error);
      throw error;
    }
  }

  /**
   * Get all available credentials for a user (without decrypting) using enhanced backend
   */
  static async listCredentials(userId: string): Promise<UserCredential[]> {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const response = await fetch(`${backendUrl}/api/enhanced-credentials/list`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'user-id': userId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to list credentials: ${response.statusText}`);
      }

      const data = await response.json();
      return data.credentials || [];

    } catch (error) {
      console.error('Error in listCredentials:', error);
      throw error;
    }
  }

  /**
   * Delete a credential using enhanced backend
   */
  static async deleteCredential(userId: string, credentialId: string): Promise<void> {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const response = await fetch(`${backendUrl}/api/enhanced-credentials`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'user-id': userId
        },
        body: JSON.stringify({
          credential_id: credentialId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to delete credential: ${response.statusText}`);
      }

    } catch (error) {
      console.error('Error in deleteCredential:', error);
      throw error;
    }
  }
}

export default CredentialManager;