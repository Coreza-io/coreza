import OAuthService from '../services/oauthService';

/**
 * Generic OAuth token refresh utility
 * Works for any OAuth provider (Schwab, Gmail, etc.)
 */
export async function refreshOAuthTokenIfNeeded(
  provider: string,
  credentials: any,
  userId: string,
  credentialId: string
): Promise<any> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = credentials.token_expires_at || 0;

  // Check if token will expire in next 60 seconds
  if (now >= expiresAt - 60) {
    console.log(`🔄 [${provider.toUpperCase()}] Access token expired, refreshing...`);

    try {
      // Use generic OAuth service to refresh
      const { tokens } = await OAuthService.refreshToken(provider, {
        user_id: userId,
        credential_id: credentialId,
      });

      console.log(`✅ [${provider.toUpperCase()}] Token refreshed successfully`);

      // Return updated credentials with new token
      return {
        ...credentials,
        access_token: tokens.access_token,
        token_expires_at: tokens.token_expires_at,
      };
    } catch (error: any) {
      throw new Error(
        `Token refresh failed: ${error.message}. Please re-authenticate your ${provider} account.`
      );
    }
  }

  // Token still valid, return as-is
  return credentials;
}
