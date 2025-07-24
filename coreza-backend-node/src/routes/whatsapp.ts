import express from 'express';
import axios from 'axios';
import { createError } from '../middleware/errorHandler';
import { QueueManager } from '../services/queueManager';

const router = express.Router();

// WhatsApp Business API configuration
const WHATSAPP_API_VERSION = 'v17.0';

interface WhatsAppCredentials {
  phone_number_id: string;
  access_token: string;
  webhook_verify_token?: string;
}

// Helper function to get WhatsApp credentials from environment or database
function getWhatsAppCredentials(): WhatsAppCredentials {
  return {
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    access_token: process.env.WHATSAPP_ACCESS_TOKEN || '',
    webhook_verify_token: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'your_verify_token'
  };
}

// Webhook verification (GET)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const credentials = getWhatsAppCredentials();

  if (mode === 'subscribe' && token === credentials.webhook_verify_token) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ WhatsApp webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook event handling (POST)
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field === 'messages') {
            await handleWhatsAppMessage(change.value);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.sendStatus(500);
  }
});

// Handle incoming WhatsApp messages
async function handleWhatsAppMessage(value: any): Promise<void> {
  try {
    if (value.messages) {
      for (const message of value.messages) {
        const phoneNumber = message.from;
        const messageText = message.text?.body || '';
        const messageType = message.type;

        console.log(`📱 Received WhatsApp message from ${phoneNumber}: ${messageText}`);

        // Queue message processing
        await QueueManager.addNotification({
          userId: 'system', // TODO: Map phone number to user ID
          type: 'websocket',
          data: {
            type: 'whatsapp_message_received',
            from: phoneNumber,
            message: messageText,
            messageType,
            timestamp: new Date().toISOString()
          }
        });

        // Auto-reply example
        if (messageText.toLowerCase().includes('hello')) {
          await sendWhatsAppMessage(phoneNumber, 'Hello! How can I help you today?');
        }
      }
    }

    // Handle message status updates
    if (value.statuses) {
      for (const status of value.statuses) {
        console.log(`📊 WhatsApp message status: ${status.status} for ${status.id}`);
      }
    }
  } catch (error) {
    console.error('Error handling WhatsApp message:', error);
  }
}

// Send WhatsApp message
router.post('/send', async (req, res, next) => {
  try {
    const { to, message, type = 'text' } = req.body;
    
    if (!to || !message) {
      throw createError('to and message are required', 400);
    }

    const result = await sendWhatsAppMessage(to, message, type);
    
    res.json({
      success: true,
      messageId: result.messages[0].id,
      message: 'WhatsApp message sent successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Send WhatsApp template message
router.post('/send-template', async (req, res, next) => {
  try {
    const { to, template_name, language_code = 'en_US', parameters = [] } = req.body;
    
    if (!to || !template_name) {
      throw createError('to and template_name are required', 400);
    }

    const credentials = getWhatsAppCredentials();
    
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
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      messageId: response.data.messages[0].id,
      message: 'WhatsApp template message sent successfully'
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`WhatsApp API error: ${JSON.stringify(error.response.data)}`, error.response.status);
    }
    next(error);
  }
});

// Send WhatsApp media message
router.post('/send-media', async (req, res, next) => {
  try {
    const { to, media_type, media_url, caption = '' } = req.body;
    
    if (!to || !media_type || !media_url) {
      throw createError('to, media_type, and media_url are required', 400);
    }

    const credentials = getWhatsAppCredentials();
    
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
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      messageId: response.data.messages[0].id,
      message: 'WhatsApp media message sent successfully'
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`WhatsApp API error: ${JSON.stringify(error.response.data)}`, error.response.status);
    }
    next(error);
  }
});

// Get WhatsApp message templates
router.get('/templates', async (req, res, next) => {
  try {
    const credentials = getWhatsAppCredentials();
    
    // Note: You need WhatsApp Business Account ID for this
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    
    if (!businessAccountId) {
      throw createError('WhatsApp Business Account ID not configured', 500);
    }

    const response = await axios.get(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${businessAccountId}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`
        }
      }
    );

    res.json({
      templates: response.data.data
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      throw createError(`WhatsApp API error: ${JSON.stringify(error.response.data)}`, error.response.status);
    }
    next(error);
  }
});

// Utility function to send WhatsApp message
async function sendWhatsAppMessage(to: string, message: string, type: string = 'text'): Promise<any> {
  const credentials = getWhatsAppCredentials();
  
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type,
    text: {
      body: message
    }
  };

  const response = await axios.post(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${credentials.phone_number_id}/messages`,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${credentials.access_token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

export default router;
export { sendWhatsAppMessage };