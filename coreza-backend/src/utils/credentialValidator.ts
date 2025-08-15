/**
 * Production-grade credential validation utilities
 */

export interface CredentialValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class CredentialValidator {
  /**
   * Validate credential structure for a given service type
   */
  static validateCredentials(serviceType: string, credentials: any): CredentialValidationResult {
    const result: CredentialValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (!credentials || typeof credentials !== 'object') {
      result.isValid = false;
      result.errors.push('Credentials must be a valid object');
      return result;
    }

    switch (serviceType.toLowerCase()) {
      case 'alpaca':
        return this.validateAlpacaCredentials(credentials, result);
      case 'dhan':
        return this.validateDhanCredentials(credentials, result);
      case 'gmail':
        return this.validateGmailCredentials(credentials, result);
      case 'whatsapp':
        return this.validateWhatsAppCredentials(credentials, result);
      case 'finnhub':
        return this.validateFinnHubCredentials(credentials, result);
      case 'yahoo':
      case 'yahoofinance':
        return this.validateYahooCredentials(credentials, result);
      default:
        result.warnings.push(`Unknown service type: ${serviceType}`);
        return result;
    }
  }

  private static validateAlpacaCredentials(creds: any, result: CredentialValidationResult): CredentialValidationResult {
    if (!creds.api_key) {
      result.isValid = false;
      result.errors.push('Alpaca API key is required');
    } else if (typeof creds.api_key !== 'string' || creds.api_key.length < 10) {
      result.isValid = false;
      result.errors.push('Invalid Alpaca API key format');
    }

    if (!creds.secret_key) {
      result.isValid = false;
      result.errors.push('Alpaca secret key is required');
    } else if (typeof creds.secret_key !== 'string' || creds.secret_key.length < 10) {
      result.isValid = false;
      result.errors.push('Invalid Alpaca secret key format');
    }

    return result;
  }

  private static validateDhanCredentials(creds: any, result: CredentialValidationResult): CredentialValidationResult {
    if (!creds.client_id) {
      result.isValid = false;
      result.errors.push('Dhan client ID is required');
    }

    if (!creds.access_token) {
      result.isValid = false;
      result.errors.push('Dhan access token is required');
    }

    return result;
  }

  private static validateGmailCredentials(creds: any, result: CredentialValidationResult): CredentialValidationResult {
    if (!creds.client_id) {
      result.isValid = false;
      result.errors.push('Gmail client ID is required');
    }

    if (!creds.client_secret) {
      result.isValid = false;
      result.errors.push('Gmail client secret is required');
    }

    if (!creds.refresh_token) {
      result.warnings.push('Gmail refresh token not provided - may need re-authentication');
    }

    return result;
  }

  private static validateWhatsAppCredentials(creds: any, result: CredentialValidationResult): CredentialValidationResult {
    if (!creds.access_token) {
      result.isValid = false;
      result.errors.push('WhatsApp access token is required');
    }

    if (!creds.phone_number_id) {
      result.isValid = false;
      result.errors.push('WhatsApp phone number ID is required');
    }

    return result;
  }

  private static validateFinnHubCredentials(creds: any, result: CredentialValidationResult): CredentialValidationResult {
    if (!creds.api_key) {
      result.isValid = false;
      result.errors.push('FinnHub API key is required');
    } else if (typeof creds.api_key !== 'string' || creds.api_key.length < 10) {
      result.isValid = false;
      result.errors.push('Invalid FinnHub API key format');
    }

    return result;
  }

  private static validateYahooCredentials(creds: any, result: CredentialValidationResult): CredentialValidationResult {
    // Yahoo Finance typically doesn't require credentials for basic operations
    // but may require API keys for premium features
    if (creds.api_key && (typeof creds.api_key !== 'string' || creds.api_key.length < 5)) {
      result.warnings.push('Yahoo Finance API key format may be invalid');
    }

    return result;
  }

  /**
   * Sanitize credentials for logging (remove sensitive data)
   */
  static sanitizeForLogging(credentials: any): any {
    if (!credentials || typeof credentials !== 'object') {
      return credentials;
    }

    const sanitized = { ...credentials };
    const sensitiveFields = [
      'api_key', 'secret_key', 'access_token', 'refresh_token', 
      'client_secret', 'password', 'private_key'
    ];

    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        const value = sanitized[field];
        if (typeof value === 'string' && value.length > 8) {
          sanitized[field] = `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
        } else {
          sanitized[field] = '[REDACTED]';
        }
      }
    });

    return sanitized;
  }
}