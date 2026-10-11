#!/usr/bin/env npx tsx
import fieldExpressions from "../coreza-backend/src/nodes/logic/fieldExpression";
const { FIELD_ADAPTERS } = fieldExpressions;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { NodeConfigSchema } from "../src/nodes/schemas/nodeSchema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NODES_DIR = path.join(__dirname, "../src/nodes");

async function validateAllNodes() {
  const files = fs.readdirSync(NODES_DIR).filter((f) => f.endsWith(".json"));
  let hasErrors = false;
  const results: { file: string; valid: boolean; errors?: string[] }[] = [];

  for (const file of files) {
    const filePath = path.join(NODES_DIR, file);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const visit = (fields: any[], prefix = '') => {
      for (const field of fields) {
        if (!FIELD_ADAPTERS[field.type]) { hasErrors = true; console.error(`${file}: ${prefix}${field.key}: no expression adapter for ${field.type}`); }
        if (field.items) visit([field.items], `${prefix}${field.key}[].`);
        visit(field.subFields ?? [], `${prefix}${field.key}.`);
      }
    };
    visit(content.fields ?? []);
    const result = NodeConfigSchema.safeParse(content);

    if (!result.success) {
      hasErrors = true;
      const errors = result.error.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`);
      results.push({ file, valid: false, errors });
      console.error(`❌ ${file}`);
      errors.forEach((e) => console.error(e));
    } else {
      results.push({ file, valid: true });
      console.log(`✅ ${file}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total: ${files.length} nodes`);
  console.log(`Valid: ${results.filter((r) => r.valid).length}`);
  console.log(`Invalid: ${results.filter((r) => !r.valid).length}`);

  if (hasErrors) {
    process.exit(1);
  }
}

validateAllNodes();
