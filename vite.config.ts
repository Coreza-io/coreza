import type { HmrContext, Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { NodeConfigSchema } from "./src/nodes/schemas/nodeSchema";

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
