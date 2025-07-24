import express from 'express';
import { google } from 'googleapis';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';
import { QueueManager } from '../services/queueManager';

const router = express.Router();

// Gmail API configuration
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose'
];

interface GmailCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  refresh_token?: string;
  access_token?: string;
}

// Helper function to get Gmail credentials
async function getGmailCredentials(userId: string, credentialId: string): Promise<GmailCredentials> {
  try {
    const { data, error } = await supabase
      .from('user_credentials')
      .select('client_json, token_json')
      .eq('user_id', userId)
      .eq('name', credentialId)
      .eq('service_type', 'gmail')
      .single();

    if (error || !data) {
      throw createError('Gmail credentials not found', 404);
    }

    return {
      ...data.client_json,
      ...data.token_json
    };
  } catch (error) {
    throw createError('Failed to retrieve Gmail credentials', 500);
  }
}

// Create Gmail OAuth client
function createGmailAuth(credentials: GmailCredentials): any {
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

// Gmail OAuth flow - Get auth URL
router.post('/auth/url', async (req, res, next) => {
  try {
    const { user_id, credential_name, client_id, client_secret, redirect_uri } = req.body;
    
    if (!user_id || !credential_name || !client_id || !client_secret || !redirect_uri) {
      throw createError('Missing required parameters', 400);
    }

    // Save client credentials
    await supabase
      .from('user_credentials')
      .upsert({
        user_id,
        name: credential_name,
        service_type: 'gmail',
        client_json: { client_id, client_secret, redirect_uri }
      });

    // Generate auth URL
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent'
    });

    res.json({
      auth_url: authUrl,
      message: 'Visit the auth URL to authorize Gmail access'
    });
  } catch (error) {
    next(error);
  }
});

// Gmail OAuth flow - Exchange code for tokens
router.post('/auth/callback', async (req, res, next) => {
  try {
    const { user_id, credential_name, code } = req.body;
    
    if (!user_id || !credential_name || !code) {
      throw createError('Missing required parameters', 400);
    }

    // Get stored client credentials
    const { data: credData, error: credError } = await supabase
      .from('user_credentials')
      .select('client_json')
      .eq('user_id', user_id)
      .eq('name', credential_name)
      .eq('service_type', 'gmail')
      .single();

    if (credError || !credData) {
      throw createError('Gmail client credentials not found', 404);
    }

    const credentials = credData.client_json;
    const auth = createGmailAuth(credentials);

    // Exchange code for tokens
    const { tokens } = await auth.getToken(code);
    
    // Update credentials with tokens
    await supabase
      .from('user_credentials')
      .update({
        token_json: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date
        }
      })
      .eq('user_id', user_id)
      .eq('name', credential_name)
      .eq('service_type', 'gmail');

    res.json({
      message: 'Gmail authorization successful',
      expires_at: tokens.expiry_date
    });
  } catch (error) {
    next(error);
  }
});

// Send email
router.post('/send', async (req, res, next) => {
  try {
    const { user_id, credential_id, to, subject, body, html } = req.body;
    
    if (!user_id || !credential_id || !to || !subject || !body) {
      throw createError('Missing required parameters', 400);
    }

    const credentials = await getGmailCredentials(user_id, credential_id);
    const auth = createGmailAuth(credentials);
    const gmail = google.gmail({ version: 'v1', auth });

    // Create email message
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html || body
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    // Send email
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    res.json({
      success: true,
      messageId: result.data.id,
      message: 'Email sent successfully'
    });
  } catch (error) {
    if (error.response?.status === 401) {
      throw createError('Gmail authentication expired. Please re-authorize.', 401);
    }
    next(error);
  }
});

// Get emails
router.post('/messages', async (req, res, next) => {
  try {
    const { user_id, credential_id, query, max_results = 10 } = req.body;
    
    if (!user_id || !credential_id) {
      throw createError('user_id and credential_id are required', 400);
    }

    const credentials = await getGmailCredentials(user_id, credential_id);
    const auth = createGmailAuth(credentials);
    const gmail = google.gmail({ version: 'v1', auth });

    // List messages
    const listResult = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: max_results
    });

    const messages = [];
    
    if (listResult.data.messages) {
      // Get detailed message data for each message
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

    res.json({
      messages,
      resultSizeEstimate: listResult.data.resultSizeEstimate
    });
  } catch (error) {
    if (error.response?.status === 401) {
      throw createError('Gmail authentication expired. Please re-authorize.', 401);
    }
    next(error);
  }
});

// Get specific email content
router.post('/message/:messageId', async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { user_id, credential_id } = req.body;
    
    if (!user_id || !credential_id) {
      throw createError('user_id and credential_id are required', 400);
    }

    const credentials = await getGmailCredentials(user_id, credential_id);
    const auth = createGmailAuth(credentials);
    const gmail = google.gmail({ version: 'v1', auth });

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

    res.json({
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
    });
  } catch (error) {
    if (error.response?.status === 401) {
      throw createError('Gmail authentication expired. Please re-authorize.', 401);
    }
    next(error);
  }
});

export default router;