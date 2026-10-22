import type { HmrContext, Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { NodeConfigSchema } from "./src/nodes/schemas/nodeSchema";

// Bundle fallback SVG text without importing files from Vite's public directory.
const iconsDirectory = path.resolve(__dirname, "public/assets/icons");
const bundledNodeIcons = Object.fromEntries(
  fs.readdirSync(iconsDirectory)
    .filter((file) => file.endsWith(".svg"))
    .sort()
    .map((file) => [
      `/assets/icons/${file}`,
      fs.readFileSync(path.join(iconsDirectory, file), "utf-8"),
    ]),
);

function nodeValidatorPlugin(): Plugin {
  return {
    name: "node-validator",
    handleHotUpdate({ file, server }: HmrContext & { server: ViteDevServer }) {
      if (file.endsWith(".json") && file.includes("/nodes/")) {
        const content = JSON.parse(fs.readFileSync(file, "utf-8"));
        const result = NodeConfigSchema.safeParse(content);
        if (!result.success) {
          server.ws.send({
            type: "error",
            err: {
              message: `Node validation failed: ${file}`,
              stack: result.error.errors.map((e) => e.message).join("\n"),
            },
          });
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUNDLED_NODE_ICONS__: JSON.stringify(bundledNodeIcons),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "development" && nodeValidatorPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
