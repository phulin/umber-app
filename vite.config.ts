import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    fs: {
      allow: [".", "../umber2/target/umber-wasm-package"],
    },
  },
  optimizeDeps: {
    include: ["@codemirror/state", "@codemirror/view"],
  },
});
