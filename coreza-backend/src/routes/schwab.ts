import express from 'express';
import axios from 'axios';
import CredentialManager from '../utils/credentialManager';
import EnvelopeEncryptionUtil from '../utils/envelopeEncryption';

const router = express.Router();

// Temporary storage for OAuth sessions (in-memory for MVP)
const tempAuthSessions = new Map<string, { app_key: string, app_secret: string, expires: number }>();

// Clean up expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of tempAuthSessions.entries()) {
    if (now > session.expires) {
      tempAuthSessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

// Step 1: Generate authorization URL
router.post('/generate-auth-url', async (req, res) => {
  try {
    const { app_key, app_secret } = req.body;

    if (!app_key || !app_secret) {
      return res.status(400).json({ 
        success: false, 
        error: 'app_key and app_secret are required' 
      });
    }

    // Generate temp session ID
    const temp_id = `schwab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store credentials temporarily (10 minute expiry)
    tempAuthSessions.set(temp_id, {
      app_key,
      app_secret,
      expires: Date.now() + (10 * 60 * 1000)
    });

    // Generate Schwab authorization URL
    const auth_url = `https://api.schwabapi.com/v1/oauth/authorize?client_id=${app_key}&redirect_uri=https://127.0.0.1`;

    console.log('🔐 [SCHWAB-AUTH] Generated auth URL for temp session:', temp_id);

    res.json({ 
      success: true, 
      auth_url, 
      temp_id 
    });
  } catch (error: any) {
    console.error('[SCHWAB-AUTH] Error generating auth URL:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate authorization URL' 
    });
  }
});

// Step 2: Exchange authorization code for tokens
router.post('/exchange-token', async (req, res) => {
  try {
    const { temp_id, redirect_url, credential_name, user_id } = req.body;

    if (!temp_id || !redirect_url || !credential_name || !user_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'temp_id, redirect_url, credential_name, and user_id are required' 
      });
    }

    // Retrieve stored credentials
    const session = tempAuthSessions.get(temp_id);
    if (!session) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired session. Please try again.' 
      });
    }

    // Check if session expired
    if (Date.now() > session.expires) {
      tempAuthSessions.delete(temp_id);
      return res.status(400).json({ 
        success: false, 
        error: 'Session expired. Please start the connection process again.' 
      });
    }

    // Extract authorization code from redirect URL
    const codeMatch = redirect_url.match(/code=([^&]+)/);
    if (!codeMatch) {
      return res.status(400).json({ 
        success: false, 
        error: 'Could not extract authorization code from redirect URL. Please ensure you copied the full URL.' 
      });
    }

    // Always URL-decode and trim the authorization code
    let code = decodeURIComponent(codeMatch[1]).trim();

    console.log('🔑 [SCHWAB-AUTH] Exchanging authorization code for tokens...');

    // Create Basic Auth header
    const credentials = `${session.app_key}:${session.app_secret}`;
    const encodedCredentials = Buffer.from(credentials).toString('base64');

    // Exchange code for tokens
    const tokenResponse = await axios.post(
      'https://api.schwabapi.com/v1/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'https://127.0.0.1'
      }),
      {
        headers: {
          'Authorization': `Basic ${encodedCredentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    console.log('✅ [SCHWAB-AUTH] Successfully obtained tokens');

    // Calculate token expiry timestamp
    const token_expires_at = Math.floor(Date.now() / 1000) + expires_in;

    // Store credentials in database using envelope encryption
    const payload = {
      service_type: 'schwab',
      name: credential_name,
      client: {
        app_key: session.app_key,
        app_secret: session.app_secret
      },
      token: {
        access_token,
        refresh_token,
        token_expires_at
      },
      meta: {
        created_with_envelope: true,
        oauth_completed_at: new Date().toISOString()
      }
    };

    const encrypted = EnvelopeEncryptionUtil.encrypt(payload, user_id);

    const { data: insertData, error: insertError } = await req.app.locals.supabase
      .from('user_credentials')
      .insert({
        user_id,
        service_type: 'schwab',
        name: credential_name,
        is_encrypted: true,
        enc_version: 1,
        key_ref: encrypted.keyRef,
        enc_payload: encrypted.encPayload,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        dek_wrapped: encrypted.dekWrapped,
        scopes: 'api'
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[SCHWAB-AUTH] Database error:', insertError);
      throw new Error(`Failed to store credentials: ${insertError.message}`);
    }

    // Clean up temporary session
    tempAuthSessions.delete(temp_id);

    console.log('💾 [SCHWAB-AUTH] Credentials stored successfully');

    res.json({ 
      success: true, 
      credential_id: insertData.id,
      message: 'Schwab account connected successfully!' 
    });
  } catch (error: any) {
    console.error('[SCHWAB-AUTH] Error exchanging token:', error);
    
    // Provide helpful error messages
    let errorMessage = 'Failed to exchange authorization code for tokens';
    
    if (error.response?.data) {
      errorMessage = `Schwab API error: ${error.response.data.error_description || error.response.data.error || 'Unknown error'}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({ 
      success: false, 
      error: errorMessage
    });
  }
});

// Step 3: Refresh access token
router.post('/refresh-token', async (req, res) => {
  try {
    const { user_id, credential_id } = req.body;

    if (!user_id || !credential_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'user_id and credential_id are required' 
      });
    }

    console.log('🔄 [SCHWAB-AUTH] Refreshing access token...');

    // Get stored credentials
    const result = await CredentialManager.getCredentials(user_id, 'schwab', credential_id);
    
    if (!result.credentials) {
      return res.status(404).json({ 
        success: false, 
        error: 'Credentials not found' 
      });
    }

    const creds = result.credentials.client_json;

    // Create Basic Auth header
    const credentials = `${creds.app_key}:${creds.app_secret}`;
    const encodedCredentials = Buffer.from(credentials).toString('base64');

    // Refresh the token
    const tokenResponse = await axios.post(
      'https://api.schwabapi.com/v1/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token
      }),
      {
        headers: {
          'Authorization': `Basic ${encodedCredentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, expires_in } = tokenResponse.data;
    const token_expires_at = Math.floor(Date.now() / 1000) + expires_in;

    console.log('✅ [SCHWAB-AUTH] Token refreshed successfully');

    // Update stored credentials with new access token
    const payload = {
      service_type: 'schwab',
      name: credential_id,
      client: {
        app_key: creds.app_key,
        app_secret: creds.app_secret
      },
      token: {
        access_token,
        refresh_token: creds.refresh_token, // Keep existing refresh token
        token_expires_at
      },
      meta: {
        last_token_refresh: new Date().toISOString()
      }
    };

    const encrypted = EnvelopeEncryptionUtil.encrypt(payload, user_id);

    const { error: updateError } = await req.app.locals.supabase
      .from('user_credentials')
      .update({
        enc_payload: encrypted.encPayload,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        dek_wrapped: encrypted.dekWrapped,
        updated_at: new Date().toISOString()
      })
      .eq('id', credential_id)
      .eq('user_id', user_id);

    if (updateError) {
      throw new Error(`Failed to update credentials: ${updateError.message}`);
    }

    res.json({ 
      success: true, 
      new_access_token: access_token,
      expires_at: token_expires_at
    });
  } catch (error: any) {
    console.error('[SCHWAB-AUTH] Error refreshing token:', error);
    
    let errorMessage = 'Failed to refresh access token';
    
    if (error.response?.data) {
      errorMessage = `Schwab API error: ${error.response.data.error_description || error.response.data.error || 'Unknown error'}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({ 
      success: false, 
      error: errorMessage
    });
  }
});

export default router;
