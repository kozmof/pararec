import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    // IPv4 so WSL / devcontainer port forwarding reaches it.
    host: "127.0.0.1",
    // Forward API calls to the Zig server (`pnpm dev:local`).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4545",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            const origin = incoming.headers.origin;
            // Preserve foreign or missing origins so the local server can reject them.
            if (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173") {
              request.setHeader("origin", "http://127.0.0.1:4545");
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
