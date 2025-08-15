/**
 * Background migration service for converting legacy credentials 
 * to envelope encryption format
 */

import { supabase } from '../config/supabase';
import EnhancedCredentialManager from './enhancedCredentialManager';

export interface MigrationStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  remaining: number;
  progress: number;
  errors: Array<{
    credentialId: string;
    serviceType: string;
    name: string;
    error: string;
    timestamp: string;
  }>;
}

export interface MigrationOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  userId?: string;
  serviceType?: string;
  dryRun?: boolean;
}

class MigrationService {
  private static readonly DEFAULT_BATCH_SIZE = 10;
  private static readonly DEFAULT_DELAY_MS = 1000;

  /**
   * Get overall migration statistics
   */
  static async getGlobalMigrationStats(): Promise<MigrationStats> {
    try {
      // Get total counts
      const { data: totalData, error: totalError } = await supabase
        .from('user_credentials')
        .select('id, service_type, name, is_encrypted', { count: 'exact' });

      if (totalError) {
        throw new Error(`Failed to fetch total credentials: ${totalError.message}`);
      }

      const total = totalData?.length || 0;
      const encrypted = totalData?.filter(row => row.is_encrypted).length || 0;
      const remaining = total - encrypted;
      const progress = total > 0 ? Math.round((encrypted / total) * 100) : 100;

      return {
        total,
        processed: encrypted,
        successful: encrypted, // Assume all encrypted ones were successful
        failed: 0, // We don't track failed migrations in main table
        remaining,
        progress,
        errors: []
      };

    } catch (error) {
      console.error('Error getting migration stats:', error);
      throw error;
    }
  }

  /**
   * Get legacy credentials that need migration
   */
  static async getLegacyCredentials(options: MigrationOptions = {}): Promise<Array<{
    id: string;
    user_id: string;
    service_type: string;
    name: string;
    client_json: any;
    token_json: any;
    scopes: string | null;
  }>> {
    try {
      let query = supabase
        .from('user_credentials')
        .select('id, user_id, service_type, name, client_json, token_json, scopes')
        .eq('is_encrypted', false)
        .order('created_at', { ascending: true });

      if (options.userId) {
        query = query.eq('user_id', options.userId);
      }

      if (options.serviceType) {
        query = query.eq('service_type', options.serviceType);
      }

      if (options.batchSize) {
        query = query.limit(options.batchSize);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch legacy credentials: ${error.message}`);
      }

      return data || [];

    } catch (error) {
      console.error('Error getting legacy credentials:', error);
      throw error;
    }
  }

  /**
   * Migrate a batch of legacy credentials
   */
  static async migrateBatch(
    credentials: Array<{
      id: string;
      user_id: string;
      service_type: string;
      name: string;
    }>,
    options: MigrationOptions = {}
  ): Promise<{
    successful: number;
    failed: number;
    errors: Array<{ credentialId: string; error: string }>;
  }> {
    let successful = 0;
    let failed = 0;
    const errors: Array<{ credentialId: string; error: string }> = [];

    for (const credential of credentials) {
      try {
        if (options.dryRun) {
          console.log(`[DRY RUN] Would migrate credential ${credential.id} (${credential.service_type}:${credential.name})`);
          successful++;
          continue;
        }

        const result = await EnhancedCredentialManager.migrateCredential(
          credential.id,
          credential.user_id,
          credential.service_type,
          credential.name
        );

        if (result.success) {
          successful++;
          console.log(`✅ Migrated credential ${credential.id} (${credential.service_type}:${credential.name})`);
        } else {
          failed++;
          errors.push({
            credentialId: credential.id,
            error: result.error || 'Unknown migration error'
          });
          console.error(`❌ Failed to migrate credential ${credential.id}:`, result.error);
        }

      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          credentialId: credential.id,
          error: errorMessage
        });
        console.error(`❌ Exception migrating credential ${credential.id}:`, error);
      }

      // Small delay between individual migrations to avoid overwhelming the system
      if (options.delayBetweenBatches && options.delayBetweenBatches > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return { successful, failed, errors };
  }

  /**
   * Run full migration process
   */
  static async runMigration(options: MigrationOptions = {}): Promise<MigrationStats> {
    const startTime = Date.now();
    const batchSize = options.batchSize || this.DEFAULT_BATCH_SIZE;
    const delay = options.delayBetweenBatches || this.DEFAULT_DELAY_MS;

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    const allErrors: MigrationStats['errors'] = [];

    console.log(`🚀 Starting migration process${options.dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`📊 Batch size: ${batchSize}, Delay: ${delay}ms`);

    if (options.userId) {
      console.log(`👤 User filter: ${options.userId}`);
    }

    if (options.serviceType) {
      console.log(`🔧 Service type filter: ${options.serviceType}`);
    }

    try {
      let hasMore = true;
      let batchNumber = 1;

      while (hasMore) {
        console.log(`\n📦 Processing batch ${batchNumber}...`);

        // Get next batch of legacy credentials
        const legacyCredentials = await this.getLegacyCredentials({
          ...options,
          batchSize
        });

        if (legacyCredentials.length === 0) {
          hasMore = false;
          console.log('✅ No more credentials to migrate');
          break;
        }

        console.log(`📋 Found ${legacyCredentials.length} credentials in batch ${batchNumber}`);

        // Migrate the batch
        const batchResult = await this.migrateBatch(legacyCredentials, options);

        totalProcessed += legacyCredentials.length;
        totalSuccessful += batchResult.successful;
        totalFailed += batchResult.failed;

        // Collect errors with additional context
        for (const error of batchResult.errors) {
          const credential = legacyCredentials.find(c => c.id === error.credentialId);
          allErrors.push({
            credentialId: error.credentialId,
            serviceType: credential?.service_type || 'unknown',
            name: credential?.name || 'unknown',
            error: error.error,
            timestamp: new Date().toISOString()
          });
        }

        console.log(`✅ Batch ${batchNumber} completed: ${batchResult.successful} successful, ${batchResult.failed} failed`);

        // Check if we should continue
        if (legacyCredentials.length < batchSize) {
          hasMore = false;
        }

        // Delay between batches
        if (hasMore && delay > 0) {
          console.log(`⏳ Waiting ${delay}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        batchNumber++;
      }

      const duration = Date.now() - startTime;
      const stats = await this.getGlobalMigrationStats();

      console.log(`\n🎉 Migration completed in ${duration}ms`);
      console.log(`📊 Total processed: ${totalProcessed}`);
      console.log(`✅ Successful: ${totalSuccessful}`);
      console.log(`❌ Failed: ${totalFailed}`);
      console.log(`📈 Overall progress: ${stats.progress}%`);

      return {
        ...stats,
        processed: totalProcessed,
        successful: totalSuccessful,
        failed: totalFailed,
        errors: allErrors
      };

    } catch (error) {
      console.error('❌ Migration process failed:', error);
      throw error;
    }
  }

  /**
   * Validate migration integrity
   */
  static async validateMigration(userId?: string): Promise<{
    valid: boolean;
    issues: Array<{
      credentialId: string;
      issue: string;
      severity: 'warning' | 'error';
    }>;
  }> {
    try {
      const issues: Array<{
        credentialId: string;
        issue: string;
        severity: 'warning' | 'error';
      }> = [];

      let query = supabase
        .from('user_credentials')
        .select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch credentials for validation: ${error.message}`);
      }

      for (const credential of data || []) {
        // Check for inconsistent state
        if (credential.is_encrypted) {
          if (!credential.enc_payload) {
            issues.push({
              credentialId: credential.id,
              issue: 'Marked as encrypted but missing enc_payload',
              severity: 'error'
            });
          }

          if (!credential.dek_wrapped) {
            issues.push({
              credentialId: credential.id,
              issue: 'Marked as encrypted but missing dek_wrapped',
              severity: 'error'
            });
          }

          if (credential.client_json || credential.token_json) {
            issues.push({
              credentialId: credential.id,
              issue: 'Encrypted credential still has legacy data',
              severity: 'warning'
            });
          }
        } else {
          if (!credential.client_json && !credential.token_json) {
            issues.push({
              credentialId: credential.id,
              issue: 'Legacy credential missing both client_json and token_json',
              severity: 'error'
            });
          }
        }

        // Check for invalid key_ref
        if (credential.is_encrypted && credential.key_ref && !credential.key_ref.startsWith('env:')) {
          issues.push({
            credentialId: credential.id,
            issue: `Invalid key_ref format: ${credential.key_ref}`,
            severity: 'error'
          });
        }
      }

      return {
        valid: issues.filter(i => i.severity === 'error').length === 0,
        issues
      };

    } catch (error) {
      console.error('Error validating migration:', error);
      throw error;
    }
  }

  /**
   * Get migration recommendations
   */
  static async getMigrationRecommendations(): Promise<{
    shouldMigrate: boolean;
    urgency: 'low' | 'medium' | 'high';
    recommendations: string[];
    estimatedTime: string;
  }> {
    try {
      const stats = await this.getGlobalMigrationStats();
      const recommendations: string[] = [];
      let urgency: 'low' | 'medium' | 'high' = 'low';

      if (stats.remaining === 0) {
        return {
          shouldMigrate: false,
          urgency: 'low',
          recommendations: ['All credentials are already migrated'],
          estimatedTime: '0 minutes'
        };
      }

      if (stats.remaining > 100) {
        urgency = 'high';
        recommendations.push('Large number of credentials need migration');
        recommendations.push('Consider running migration during off-peak hours');
        recommendations.push('Use smaller batch sizes to avoid system overload');
      } else if (stats.remaining > 10) {
        urgency = 'medium';
        recommendations.push('Moderate number of credentials need migration');
        recommendations.push('Migration can be run during normal hours');
      } else {
        urgency = 'low';
        recommendations.push('Small number of credentials need migration');
        recommendations.push('Migration should complete quickly');
      }

      // Estimate time (rough calculation)
      const estimatedMinutes = Math.ceil(stats.remaining / 10); // Assume 10 credentials per minute
      const estimatedTime = estimatedMinutes < 1 ? '< 1 minute' : `${estimatedMinutes} minutes`;

      recommendations.push(`Estimated migration time: ${estimatedTime}`);
      recommendations.push('Review migration logs for any errors');
      recommendations.push('Validate migration integrity after completion');

      return {
        shouldMigrate: true,
        urgency,
        recommendations,
        estimatedTime
      };

    } catch (error) {
      console.error('Error getting migration recommendations:', error);
      throw error;
    }
  }
}

export default MigrationService;