import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  optimizeDeps: {
    include: ["@codemirror/state", "@codemirror/view"],
  },
});
