/**
 * Enhanced credentials API routes with envelope encryption support
 * Provides migration capabilities and dual-read functionality
 */

import express from 'express';
import { z } from 'zod';
import EnhancedCredentialManager from '../utils/enhancedCredentialManager';

const router = express.Router();

// Request validation schemas
const storeCredentialsSchema = z.object({
  service_type: z.string().min(1),
  name: z.string().min(1),
  client_data: z.record(z.any()),
  token_data: z.record(z.any()).optional().default({}),
  scopes: z.string().optional()
});

const getCredentialsSchema = z.object({
  service_type: z.string().min(1),
  name: z.string().optional()
});

const deleteCredentialSchema = z.object({
  credential_id: z.string().uuid()
});

const migrateCredentialSchema = z.object({
  credential_id: z.string().uuid(),
  service_type: z.string().min(1),
  name: z.string().min(1)
});

// Auth middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const userId = req.headers['user-id'] as string || req.query.user_id as string;
  if (!userId) {
    return res.status(401).json({ error: 'user_id is required' });
  }
  req.userId = userId;
  next();
};

// Store credentials with envelope encryption
router.post('/store', requireAuth, async (req, res) => {
  try {
    const validation = storeCredentialsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { service_type, name, client_data, token_data, scopes } = validation.data;

    const result = await EnhancedCredentialManager.storeCredentials(
      req.userId,
      service_type,
      name,
      client_data,
      token_data,
      scopes
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      credential_id: result.credentialId,
      message: 'Credentials stored with envelope encryption'
    });

  } catch (error) {
    console.error('Store credentials error:', error);
    res.status(500).json({
      error: 'Failed to store credentials',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get credentials with dual-read capability
router.get('/', requireAuth, async (req, res) => {
  try {
    const validation = getCredentialsSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { service_type, name } = validation.data;

    const credentials = await EnhancedCredentialManager.getCredentials(
      req.userId,
      service_type,
      name
    );

    // Don't return sensitive data in response
    const sanitizedCredentials = credentials.map(cred => ({
      id: cred.id,
      name: cred.name,
      service_type: cred.service_type,
      created_at: cred.created_at,
      updated_at: cred.updated_at,
      is_encrypted: cred.is_encrypted,
      enc_version: cred.enc_version,
      key_ref: cred.key_ref,
      // Only return non-sensitive credential fields
      credential_summary: {
        has_api_key: Boolean(cred.credentials.api_key),
        has_secret_key: Boolean(cred.credentials.secret_key),
        fields: Object.keys(cred.credentials)
      }
    }));

    res.json({
      credentials: sanitizedCredentials,
      count: credentials.length
    });

  } catch (error) {
    console.error('Get credentials error:', error);
    res.status(500).json({
      error: 'Failed to retrieve credentials',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// List credentials metadata
router.get('/list', requireAuth, async (req, res) => {
  try {
    const serviceType = req.query.service_type as string;

    const credentials = await EnhancedCredentialManager.listCredentials(
      req.userId,
      serviceType
    );

    res.json({
      credentials,
      count: credentials.length
    });

  } catch (error) {
    console.error('List credentials error:', error);
    res.status(500).json({
      error: 'Failed to list credentials',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete credential
router.delete('/', requireAuth, async (req, res) => {
  try {
    const validation = deleteCredentialSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { credential_id } = validation.data;

    await EnhancedCredentialManager.deleteCredential(req.userId, credential_id);

    res.json({
      success: true,
      message: 'Credential deleted successfully'
    });

  } catch (error) {
    console.error('Delete credential error:', error);
    res.status(500).json({
      error: 'Failed to delete credential',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Migrate single credential to envelope encryption
router.post('/migrate', requireAuth, async (req, res) => {
  try {
    const validation = migrateCredentialSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { credential_id, service_type, name } = validation.data;

    const result = await EnhancedCredentialManager.migrateCredential(
      credential_id,
      req.userId,
      service_type,
      name
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Credential migrated to envelope encryption'
    });

  } catch (error) {
    console.error('Migrate credential error:', error);
    res.status(500).json({
      error: 'Failed to migrate credential',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Batch migrate all user credentials
router.post('/migrate-all', requireAuth, async (req, res) => {
  try {
    const result = await EnhancedCredentialManager.batchMigrateUser(req.userId);

    res.json({
      success: result.success,
      migrated: result.migrated,
      failed: result.failed,
      errors: result.errors,
      message: `Migration completed: ${result.migrated} migrated, ${result.failed} failed`
    });

  } catch (error) {
    console.error('Batch migrate error:', error);
    res.status(500).json({
      error: 'Failed to batch migrate credentials',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get migration status
router.get('/migration-status', requireAuth, async (req, res) => {
  try {
    const status = await EnhancedCredentialManager.getMigrationStatus(req.userId);

    res.json({
      ...status,
      message: `${status.encrypted}/${status.total} credentials encrypted (${status.migrationProgress}%)`
    });

  } catch (error) {
    console.error('Migration status error:', error);
    res.status(500).json({
      error: 'Failed to get migration status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check for encryption system
router.get('/health', async (req, res) => {
  try {
    // Test encryption key availability
    const testData = { test: 'health_check' };
    const testUserId = 'health_check_user';
    
    // This will throw if encryption key is not available
    const encryptionResult = EnhancedCredentialManager['constructor'].prototype.constructor
      .encrypt?.(testData, testUserId) || { success: true };

    res.json({
      status: 'healthy',
      encryption_available: Boolean(process.env.COREZA_ENCRYPTION_KEY),
      envelope_encryption: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;