/**
 * Frontend Credential Manager - Backend API Integration
 * Handles credential storage via backend API (encryption done server-side)
 */

import { supabase } from '@/integrations/supabase/client';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export class CredentialManager {
  /**
   * Store credentials via backend API (encryption handled server-side)
   */
  static async storeCredentials(
    userId: string, 
    serviceType: string, 
    credentialName: string, 
    credentials: any, 
    scopes?: string
  ): Promise<void> {
    // Input validation
    if (!userId || !serviceType || !credentialName || !credentials) {
      throw new Error('Missing required parameters');
    }
    
    try {
      console.log(`🔐 Storing credentials for ${serviceType}:${credentialName}`);
      
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      // Send to backend for encryption and storage
      const response = await fetch(`${BACKEND_URL}/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          service_type: serviceType,
          name: credentialName,
          client_data: credentials,
          token_data: {},
          scopes
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to store credentials');
      }
      
      console.log(`✅ Successfully stored credentials for ${serviceType}:${credentialName}`);
    } catch (error) {
      console.error('Error storing credentials:', error);
      throw error;
    }
  }


  /**
   * Delete a credential
   */
  static async deleteCredential(userId: string, credentialId: string): Promise<void> {
    // Input validation
    if (!userId || !credentialId) {
      throw new Error('Missing required parameters');
    }
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      throw new Error('Invalid credential ID format');
    }
    
    try {
      const { error } = await supabase
        .from('user_credentials')
        .delete()
        .eq('id', credentialId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting credential:', error);
        throw new Error(`Failed to delete credential: ${error.message}`);
      }
      
      console.log(`🗑️ Successfully deleted credential ${credentialId}`);
    } catch (error) {
      console.error('Error deleting credential:', error);
      throw error;
    }
  }
}

export default CredentialManager;