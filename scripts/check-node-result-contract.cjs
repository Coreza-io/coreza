/** Optional source guard for executable node result producers; no application code is executed. */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, "coreza-backend/src/nodes/executors");
// LoopExecutorV2's item/control protocol is adapted explicitly by ControlFlowExecutor.
const files = fs.readdirSync(directory).filter(name => name.endsWith(".ts") && name !== "LoopExecutorV2.ts")
  .map(name => path.join(directory, name)).concat(path.join(root, "coreza-backend/src/backtest/BacktestExecutor.ts"));
const failures = [];
for (const filename of files) {
  const source = fs.readFileSync(filename, "utf8");
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function enclosingResult(node) {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isFunctionLike(current)) return current.type && /\bNodeResult\b/.test(current.type.getText(file));
    }
    return false;
  }
  function visit(node) {
    const resultBoundary = node.parent && (ts.isReturnStatement(node.parent)
      || (ts.isVariableDeclaration(node.parent) && node.parent.type && /\bNodeResult\b/.test(node.parent.type.getText(file))));
    if (ts.isObjectLiteralExpression(node) && resultBoundary && enclosingResult(node)) {
      const prohibited = node.properties.some(property => ts.isPropertyAssignment(property)
        && ["success", "formatVersion"].includes(property.name.getText(file).replace(/["']/g, "")));
      if (prohibited) {
        const position = file.getLineAndCharacterOfPosition(node.getStart(file));
        failures.push(`${path.relative(root, filename)}:${position.line + 1}: use a shared status/data constructor`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}
if (failures.length) { process.stderr.write(failures.join("\n") + "\n"); process.exitCode = 1; }
else process.stdout.write("Node result producer boundaries use the status-only contract.\n");
