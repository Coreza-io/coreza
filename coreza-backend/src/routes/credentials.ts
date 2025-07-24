import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CredentialManager, AlpacaCredentials } from '../services/credentialManager';

const router = Router();

// Validation schemas
const storeCredentialsSchema = z.object({
  service_type: z.string().min(1),
  name: z.string().min(1),
  credentials: z.object({
    api_key: z.string().min(1),
    secret_key: z.string().min(1),
    paper_trading: z.boolean().default(true)
  }),
  scopes: z.string().optional()
});

const getCredentialsSchema = z.object({
  service_type: z.string().min(1),
  name: z.string().optional()
});

const deleteCredentialsSchema = z.object({
  service_type: z.string().min(1),
  name: z.string().min(1)
});

// Middleware to extract user ID from auth header or session
const requireAuth = (req: Request, res: Response, next: any) => {
  // In a real implementation, you'd extract user ID from JWT token
  // For now, we'll use a header or query parameter
  const userId = req.headers['x-user-id'] as string || req.query.user_id as string;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'User authentication required'
    });
  }
  
  req.userId = userId;
  next();
};

// Store credentials
router.post('/store', requireAuth, async (req: Request, res: Response) => {
  try {
    const validation = storeCredentialsSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const { service_type, name, credentials, scopes } = validation.data;
    const userId = req.userId!;

    // Validate credentials if it's Alpaca
    if (service_type === 'alpaca') {
      const validationResult = await CredentialManager.validateAlpacaCredentials(credentials);
      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Alpaca credentials',
          details: validationResult.error
        });
      }
    }

    const result = await CredentialManager.storeCredentials(
      userId,
      service_type,
      name,
      credentials,
      scopes
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'Credentials stored successfully'
    });

  } catch (error) {
    console.error('Error in store credentials route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get credentials
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const validation = getCredentialsSchema.safeParse(req.query);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request parameters',
        details: validation.error.errors
      });
    }

    const { service_type, name } = validation.data;
    const userId = req.userId!;

    const result = await CredentialManager.getCredentials(userId, service_type, name);

    if (result.error) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    // Don't return the secret key in the response for security
    const safeCredentials = {
      api_key: result.credentials!.api_key,
      paper_trading: result.credentials!.paper_trading,
      // secret_key is omitted for security
    };

    res.json({
      success: true,
      credentials: safeCredentials
    });

  } catch (error) {
    console.error('Error in get credentials route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// List user credentials
router.get('/list', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const serviceType = req.query.service_type as string;

    const result = await CredentialManager.listUserCredentials(userId, serviceType);

    if (result.error) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      credentials: result.credentials
    });

  } catch (error) {
    console.error('Error in list credentials route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Delete credentials
router.delete('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const validation = deleteCredentialsSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const { service_type, name } = validation.data;
    const userId = req.userId!;

    const result = await CredentialManager.deleteCredentials(userId, service_type, name);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'Credentials deleted successfully'
    });

  } catch (error) {
    console.error('Error in delete credentials route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Validate credentials
router.post('/validate', requireAuth, async (req: Request, res: Response) => {
  try {
    const validation = z.object({
      service_type: z.string(),
      credentials: z.object({
        api_key: z.string(),
        secret_key: z.string(),
        paper_trading: z.boolean().default(true)
      })
    }).safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data'
      });
    }

    const { service_type, credentials } = validation.data;

    if (service_type === 'alpaca') {
      const result = await CredentialManager.validateAlpacaCredentials(credentials);
      
      res.json({
        success: true,
        valid: result.valid,
        error: result.error
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Unsupported service type'
      });
    }

  } catch (error) {
    console.error('Error in validate credentials route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Add user_id to request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export default router;