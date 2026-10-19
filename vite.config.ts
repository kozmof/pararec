import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    // IPv4 so WSL / devcontainer port forwarding reaches it.
    host: "127.0.0.1",
    // Forward API calls to the Zig server (`pnpm dev:api`).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4545",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            const origin = incoming.headers.origin;
            const host = incoming.headers.host;
            // Vite can select another port when 5173 is occupied. Only rewrite
            // same-origin requests to a loopback host, preserving foreign or missing origins.
            if (
              host &&
              /^(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(host) &&
              origin === `http://${host}`
            ) {
              // changeOrigin has already set Host to the HTTP API target.
              request.setHeader("origin", `http://${request.getHeader("host")}`);
            }
          });
        },
      },
    },
  },
  build: {
    // Output to the repo root, where the Zig server serves it from.
    outDir: "../dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Cache the math engine separately from the application.
            { name: "katex", test: /[/\\]node_modules[/\\]katex[/\\]/ },
          ],
        },
      },
    },
  },
  plugins: [
    svelte({
      // Relative to the Vite root (client/).
      configFile: "../svelte.config.js",
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
    }),
  ],
});
