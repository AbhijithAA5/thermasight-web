import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// ThermaSight is fully standalone: public npm only, no platform services.
export default defineConfig({
  ssr: {
    // Bundle npm deps into the server bundle so it runs on any host (Node,
    // Workers, edge). node: builtins stay external; cloudflare:workers is
    // optional and provided by the platform if bindings are ever added.
    noExternal: true,
    external: ["cloudflare:workers"],
  },
  build: {
    rollupOptions: { external: [/^cloudflare:/] },
  },
  plugins: [
    // Material Symbols SVGs import as React components via `?react`.
    svgr({
      svgrOptions: {
        icon: true,
        svgProps: { fill: "currentColor" },
        svgoConfig: {
          plugins: [
            { name: "preset-default", params: { overrides: { removeViewBox: false } } },
          ],
        },
      },
    }),
    // TanStack Start plugin must run before React's plugin.
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});