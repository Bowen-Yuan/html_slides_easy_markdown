import { defineConfig } from "vite";

/**
 * Dev-server configuration.
 *
 * The build itself is done by `bin/slides.mjs` (Markdown -> static, offline
 * HTML). Vite is only used for `slides dev`: it serves dist/ and we push a
 * full reload over its websocket after each successful rebuild.
 *
 * There is deliberately no `build` section: Vite never builds this project.
 */
export default defineConfig({
  root: "dist",
  appType: "mpa",
  clearScreen: false,
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: false,
    open: false,
  },
});
