import { google } from 'googleapis';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';
import DecryptionUtil from '../utils/decryption';
import EnhancedCredentialManager from '../utils/enhancedCredentialManager';

export interface CommunicationInput {
  user_id: string;
  credential_id: string;
  [key: string]: any;
}

export interface CommunicationResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Base communication service class
abstract class BaseCommunicationService {
  protected abstract serviceName: string;
  
  protected async getCredentials(userId: string, credentialId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('user_credentials')
        .select('client_json, token_json')
        .eq('user_id', userId)
        .eq('name', credentialId)
        .eq('service_type', this.serviceName)
        .single();
        
      if (error || !data) {
        throw createError(`${this.serviceName} credentials not found`, 404);
      }

      // Decrypt credentials before returning
      const decryptedClientJson = { ...data.client_json };
      const decryptedTokenJson = { ...data.token_json };

      try {
        // Decrypt sensitive fields if they appear to be encrypted
        if (decryptedClientJson.client_id && DecryptionUtil.isEncrypted(decryptedClientJson.client_id)) {
          decryptedClientJson.client_id = await DecryptionUtil.decrypt(decryptedClientJson.client_id);
        }
        
        if (decryptedClientJson.client_secret && DecryptionUtil.isEncrypted(decryptedClientJson.client_secret)) {
          decryptedClientJson.client_secret = await DecryptionUtil.decrypt(decryptedClientJson.client_secret);
        }
        
        if (decryptedClientJson.api_key && DecryptionUtil.isEncrypted(decryptedClientJson.api_key)) {
          decryptedClientJson.api_key = await DecryptionUtil.decrypt(decryptedClientJson.api_key);
        }
        
        if (decryptedTokenJson.access_token && DecryptionUtil.isEncrypted(decryptedTokenJson.access_token)) {
          decryptedTokenJson.access_token = await DecryptionUtil.decrypt(decryptedTokenJson.access_token);
        }
        
        if (decryptedTokenJson.refresh_token && DecryptionUtil.isEncrypted(decryptedTokenJson.refresh_token)) {
          decryptedTokenJson.refresh_token = await DecryptionUtil.decrypt(decryptedTokenJson.refresh_token);
        }
      } catch (decryptError) {
        console.error(`Error decrypting ${this.serviceName} credentials:`, decryptError);
        throw new Error(`Failed to decrypt ${this.serviceName} credentials`);
      }
      
      return {
        ...decryptedClientJson,
        ...decryptedTokenJson
      };
    } catch (error) {
      throw new Error(`Failed to get ${this.serviceName} credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  abstract execute(operation: string, input: CommunicationInput): Promise<CommunicationResult>;
}

// Gmail service
class GmailService extends BaseCommunicationService {
  protected serviceName = 'gmail';
  
  private createGmailAuth(credentials: any): any {
    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );

    if (credentials.refresh_token) {
      auth.setCredentials({
        refresh_token: credentials.refresh_token,
        access_token: credentials.access_token
      });
    }

    return auth;
  }
  
  async execute(operation: string, input: CommunicationInput): Promise<CommunicationResult> {
    try {
      const { user_id, credential_id } = input;
      const credentials = await this.getCredentials(user_id, credential_id);
      const auth = this.createGmailAuth(credentials);
      const gmail = google.gmail({ version: 'v1', auth });

      let result;
      switch (operation) {
        case 'send':
          result = await this.sendEmail(gmail, input);
          break;
        case 'messages':
          result = await this.getMessages(gmail, input);
          break;
        case 'message':
          result = await this.getMessage(gmail, input);
          break;
        default:
          throw createError(`Unsupported Gmail operation: ${operation}`, 400);
      }

      return { success: true, data: result };
    } catch (error: any) {
      if (error.response?.status === 401) {
        return { success: false, error: 'Gmail authentication expired. Please re-authorize.' };
      }
      return { success: false, error: error.message };
    }
  }
  
  private async sendEmail(gmail: any, input: CommunicationInput): Promise<any> {
    const { to, subject, body, html } = input;
    
    if (!to || !subject || !body) {
      throw createError('Missing required parameters', 400);
    }

    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html || body
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    return {
      success: true,
      messageId: result.data.id,
      message: 'Email sent successfully'
    };
  }
  
  private async getMessages(gmail: any, input: CommunicationInput): Promise<any> {
    const { query, max_results = 10 } = input;

    const listResult = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: max_results
    });

    const messages = [];
    
    if (listResult.data.messages) {
      for (const msg of listResult.data.messages.slice(0, max_results)) {
        try {
          const messageDetail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata'
          });

          const headers = messageDetail.data.payload?.headers || [];
          const getHeader = (name: string) => headers.find(h => h.name === name)?.value || '';

          messages.push({
            id: msg.id,
            threadId: msg.threadId,
            snippet: messageDetail.data.snippet,
            from: getHeader('From'),
            to: getHeader('To'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            labels: messageDetail.data.labelIds
          });
        } catch (error) {
          console.error(`Error fetching message ${msg.id}:`, error);
        }
      }
    }

    return {
      messages,
      resultSizeEstimate: listResult.data.resultSizeEstimate
    };
  }
  
  private async getMessage(gmail: any, input: CommunicationInput): Promise<any> {
    const { messageId } = input;

    const messageDetail = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    // Extract email content
    const extractContent = (part: any): { text?: string; html?: string } => {
      const content: any = {};
      
      if (part.body?.data) {
        const decodedContent = Buffer.from(part.body.data, 'base64').toString();
        if (part.mimeType === 'text/plain') {
          content.text = decodedContent;
        } else if (part.mimeType === 'text/html') {
          content.html = decodedContent;
        }
      }
      
      if (part.parts) {
        for (const subPart of part.parts) {
          Object.assign(content, extractContent(subPart));
        }
      }
      
      return content;
    };

    const headers = messageDetail.data.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name === name)?.value || '';
    const content = extractContent(messageDetail.data.payload);

    return {
      id: messageDetail.data.id,
      threadId: messageDetail.data.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: messageDetail.data.snippet,
      content: {
        text: content.text,
        html: content.html
      },
      labels: messageDetail.data.labelIds
    };
  }
}

// WhatsApp service
class WhatsAppService extends BaseCommunicationService {
  protected serviceName = 'whatsapp';
  private apiVersion = 'v17.0';
  
  async execute(operation: string, input: CommunicationInput): Promise<CommunicationResult> {
    try {
      const { user_id, credential_id } = input;
      const credentials = await this.getCredentials(user_id, credential_id);

      let result;
      switch (operation) {
        case 'send':
          result = await this.sendMessage(credentials, input);
          break;
        case 'send_template':
          result = await this.sendTemplate(credentials, input);
          break;
        case 'send_media':
          result = await this.sendMedia(credentials, input);
          break;
        default:
          throw createError(`Unsupported WhatsApp operation: ${operation}`, 400);
      }

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  
  private async sendMessage(credentials: any, input: CommunicationInput): Promise<any> {
    const { to, message, type = 'text' } = input;
    
    if (!to || !message) {
      throw createError('to and message are required', 400);
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type,
      text: {
        body: message
      }
    };

    const response = await axios.post(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      message: 'WhatsApp message sent successfully'
    };
  }
  
  private async sendTemplate(credentials: any, input: CommunicationInput): Promise<any> {
    const { to, template_name, language_code = 'en_US', parameters = [] } = input;
    
    if (!to || !template_name) {
      throw createError('to and template_name are required', 400);
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template_name,
        language: {
          code: language_code
        },
        components: parameters.length > 0 ? [
          {
            type: 'body',
            parameters: parameters.map((param: string) => ({
              type: 'text',
              text: param
            }))
          }
        ] : []
      }
    };

    const response = await axios.post(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      message: 'WhatsApp template message sent successfully'
    };
  }
  
  private async sendMedia(credentials: any, input: CommunicationInput): Promise<any> {
    const { to, media_type, media_url, caption = '' } = input;
    
    if (!to || !media_type || !media_url) {
      throw createError('to, media_type, and media_url are required', 400);
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: media_type,
      [media_type]: {
        link: media_url,
        caption: caption
      }
    };

    const response = await axios.post(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      message: 'WhatsApp media message sent successfully'
    };
  }
}

// Main communication service
export class CommunicationService {
  private static gmailService = new GmailService();
  private static whatsappService = new WhatsAppService();
  
  static async execute(service: string, operation: string, input: CommunicationInput): Promise<CommunicationResult> {
    switch (service.toLowerCase()) {
      case 'gmail':
        return this.gmailService.execute(operation, input);
      case 'whatsapp':
        return this.whatsappService.execute(operation, input);
      default:
        return { success: false, error: `Unsupported communication service: ${service}` };
    }
  }
}