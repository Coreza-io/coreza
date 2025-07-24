import express from 'express';
import { CommunicationService } from '../services/communications';
import { QueueManager } from '../services/queueManager';

const router = express.Router();

// Webhook verification (GET)
router.get('/webhook', async (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  
  const result = await CommunicationService.execute('whatsapp', 'verify_webhook', {
    mode: mode as string,
    token: token as string,
    challenge: challenge as string
  });
  
  if (result.success) {
    res.status(200).send(challenge);
  } else {
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
          await CommunicationService.execute('whatsapp', 'send_message', {
            to: phoneNumber,
            message: 'Hello! How can I help you today?'
          });
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
    
    const result = await CommunicationService.execute('whatsapp', 'send_message', {
      to,
      message,
      type
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Send WhatsApp template message
router.post('/send-template', async (req, res, next) => {
  try {
    const { to, template_name, language_code = 'en_US', parameters = [] } = req.body;
    
    const result = await CommunicationService.execute('whatsapp', 'send_template', {
      to,
      templateName: template_name,
      languageCode: language_code,
      parameters
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Send WhatsApp media message
router.post('/send-media', async (req, res, next) => {
  try {
    const { to, media_type, media_url, caption = '' } = req.body;
    
    const result = await CommunicationService.execute('whatsapp', 'send_media', {
      to,
      mediaType: media_type,
      mediaUrl: media_url,
      caption
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get WhatsApp message templates
router.get('/templates', async (req, res, next) => {
  try {
    const result = await CommunicationService.execute('whatsapp', 'get_templates', {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;