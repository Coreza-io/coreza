#!/usr/bin/env node

/**
 * Sync script to keep resolveReferences.ts identical between frontend and backend.
 * Source of truth: src/utils/resolveReferences.ts
 * Target: coreza-backend/src/utils/resolveReferences.ts
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '../src/utils/resolveReferences.ts');
const TARGET = path.join(__dirname, '../coreza-backend/src/utils/resolveReferences.ts');

try {
  console.log('🔄 Syncing resolveReferences.ts...');
  console.log(`   Source: ${SOURCE}`);
  console.log(`   Target: ${TARGET}`);

  if (!fs.existsSync(SOURCE)) {
    console.error('❌ Source file not found:', SOURCE);
    process.exit(1);
  }

  const content = fs.readFileSync(SOURCE, 'utf8');
  
  // Ensure target directory exists
  const targetDir = path.dirname(TARGET);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(TARGET, content, 'utf8');
  
  console.log('✅ Successfully synced resolveReferences.ts');
  console.log(`   ${content.split('\n').length} lines copied`);
} catch (error) {
  console.error('❌ Sync failed:', error.message);
  process.exit(1);
}
