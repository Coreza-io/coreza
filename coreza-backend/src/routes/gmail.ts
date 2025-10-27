import express from 'express';
import { CommunicationService } from '../services/communications';

const router = express.Router();

// Get user credentials list for Gmail
router.get('/credentials', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const result = await CommunicationService.execute('gmail', 'list_credentials', { userId: user_id as string });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({
      success: true,
      credentials: result.data || []
    });
  } catch (error) {
    next(error);
  }
});

// Gmail OAuth flow - Get auth URL (for authAction)
router.post('/auth-url', async (req, res, next) => {
  try {
    const { user_id, credential_name, client_id, client_secret, redirect_uri } = req.body;
    
    const result = await CommunicationService.execute('gmail', 'create_auth_url', {
      userId: user_id,
      credentialName: credential_name,
      clientId: client_id,
      clientSecret: client_secret,
      redirectUri: redirect_uri
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Gmail OAuth flow - Exchange code for tokens
router.post('/auth/callback', async (req, res, next) => {
  try {
    const { user_id, credential_name, code } = req.body;
    
    const result = await CommunicationService.execute('gmail', 'exchange_code', {
      userId: user_id,
      credentialName: credential_name,
      code
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Send email
router.post('/send', async (req, res, next) => {
  try {
    const { user_id, credential_id, to, subject, body, html } = req.body;
    
    const result = await CommunicationService.execute('gmail', 'send_email', {
      userId: user_id,
      credentialId: credential_id,
      to,
      subject,
      body,
      html
    });

    if (!result.success) {
      return res.status(result.error?.includes('authentication') ? 401 : 400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get emails
router.post('/messages', async (req, res, next) => {
  try {
    const { user_id, credential_id, query, max_results } = req.body;
    
    const result = await CommunicationService.execute('gmail', 'get_messages', {
      userId: user_id,
      credentialId: credential_id,
      query,
      maxResults: max_results
    });

    if (!result.success) {
      return res.status(result.error?.includes('authentication') ? 401 : 400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get specific email content
router.post('/message/:messageId', async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { user_id, credential_id } = req.body;
    
    const result = await CommunicationService.execute('gmail', 'get_message', {
      userId: user_id,
      credentialId: credential_id,
      messageId
    });

    if (!result.success) {
      return res.status(result.error?.includes('authentication') ? 401 : 400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;