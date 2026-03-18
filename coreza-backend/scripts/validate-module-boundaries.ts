import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, 'src');

const requiredPaths = [
  'src/nodes/logic/comparator.ts',
  'src/nodes/logic/compute.ts',
  'src/nodes/logic/indicators.ts',
  'src/nodes/logic/risk.ts',
  'src/nodes/logic/http.ts',
  'src/nodes/logic/toolOutputProcessor.ts',
  'src/nodes/logic/toolDefinitions.ts',
  'src/nodes/logic/agentSystem.ts',
  'src/engine/InMemoryStore.ts',
  'src/engine/RollingWindow.ts',
  'src/simulation/PortfolioManager.ts',
  'src/simulation/simBroker/index.ts',
  'src/infra/jobQueue/jobQueueManager.ts',
  'src/infra/jobQueue/queueInterface.ts',
  'src/infra/RedisBuffer.ts',
  'src/infra/WorkflowCache.ts',
  'src/infra/websocketManager.ts',
  'src/infra/nodeStore.ts',
  'src/workers/RunSyncService.ts',
  'src/workers/WorkflowRecoveryService.ts',
  'src/workers/StreamingCleanupService.ts',
  'src/workers/GracefulShutdownHandler.ts',
];

const forbiddenLegacyPaths = [
  'src/services/comparator.ts',
  'src/services/compute.ts',
  'src/services/indicators.ts',
  'src/services/risk.ts',
  'src/services/http.ts',
  'src/services/toolOutputProcessor.ts',
  'src/services/toolDefinitions.ts',
  'src/services/agentSystem.ts',
  'src/services/InMemoryStore.ts',
  'src/services/RollingWindow.ts',
  'src/services/PortfolioManager.ts',
  'src/services/simBroker/index.ts',
  'src/services/jobQueueManager.ts',
  'src/services/queueInterface.ts',
  'src/services/RedisBuffer.ts',
  'src/services/WorkflowCache.ts',
  'src/services/websocketManager.ts',
  'src/services/nodeStore.ts',
  'src/services/RunSyncService.ts',
  'src/services/WorkflowRecoveryService.ts',
  'src/services/StreamingCleanupService.ts',
  'src/services/GracefulShutdownHandler.ts',
  'src/services/engineV2.ts',
];

const allowedServicesEntries = new Set([
  'RegistrationService.ts',
  'StatusService.ts',
  'SubscriptionManager.ts',
  'SubscriptionService.ts',
  'WebhookService.ts',
  'WorkflowRunner.ts',
  'communication',
  'datasources',
  'index.ts',
  'oauthService.ts',
  'screeners',
  'storage',
  'workflowRunnerManager.ts',
]);

const forbiddenImportPatterns = [
  /services\/(comparator|compute|indicators|risk|http|toolOutputProcessor|toolDefinitions|agentSystem)\b/,
  /services\/(InMemoryStore|RollingWindow)\b/,
  /services\/(PortfolioManager|simBroker)\b/,
  /services\/(jobQueueManager|queueInterface|RedisBuffer|WorkflowCache|websocketManager|nodeStore)\b/,
  /services\/(RunSyncService|WorkflowRecoveryService|StreamingCleanupService|GracefulShutdownHandler)\b/,
  /services\/engineV2\b/,
];

const errors: string[] = [];

for (const relPath of requiredPaths) {
  if (!existsSync(join(repoRoot, relPath))) {
    errors.push(`Missing required reorganized path: ${relPath}`);
  }
}

for (const relPath of forbiddenLegacyPaths) {
  if (existsSync(join(repoRoot, relPath))) {
    errors.push(`Legacy path should not exist after reorg: ${relPath}`);
  }
}

const servicesEntries = readdirSync(join(srcRoot, 'services')).sort();
for (const entry of servicesEntries) {
  if (!allowedServicesEntries.has(entry)) {
    errors.push(`Unexpected entry remains in src/services: ${entry}`);
  }
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') continue;
      files.push(...walk(fullPath));
      continue;
    }

    if (entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

for (const filePath of walk(srcRoot)) {
  const content = readFileSync(filePath, 'utf8');
  for (const pattern of forbiddenImportPatterns) {
    if (pattern.test(content)) {
      errors.push(
        `Forbidden legacy import reference in ${relative(repoRoot, filePath)} matching ${pattern}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('Module boundary validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Module boundary validation passed.');
