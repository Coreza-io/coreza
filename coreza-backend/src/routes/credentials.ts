/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Enhanced credentials API routes with envelope encryption support
 * Provides migration capabilities and dual-read functionality
 */

import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/jwtAuth';
import CredentialManager from '../utils/credentialManager';
import CredentialCache from '../utils/credentialCache';

const router = express.Router();

// Apply JWT auth to all routes except health check
router.use((req, res, next) => {
  // Skip auth for health check
  if (req.path === '/health') {
    return next();
  }
  return requireAuth(req, res, next);
});

// Request validation schemas
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

// Get credentials with dual-read capability
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validation = getCredentialsSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { service_type, name } = validation.data;

    const credentials = await CredentialManager.getCredentialRecords(
      userId,
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
router.get('/list', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const serviceType = req.query.service_type as string;

    const credentials = await CredentialManager.listCredentials(
      userId,
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
router.delete('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validation = deleteCredentialSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { credential_id } = validation.data;

    await CredentialManager.deleteCredential(userId, credential_id);
    await CredentialCache.getInstance().invalidate(userId);

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
router.post('/migrate', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validation = migrateCredentialSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.errors
      });
    }

    const { credential_id, service_type, name } = validation.data;

    const result = await CredentialManager.migrateCredential(
      credential_id,
      userId,
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
router.post('/migrate-all', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await CredentialManager.batchMigrateUser(userId);

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
router.get('/migration-status', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const status = await CredentialManager.getMigrationStatus(userId);

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

// Health check for encryption system (no auth required)
router.get('/health', async (req, res) => {
  try {
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
