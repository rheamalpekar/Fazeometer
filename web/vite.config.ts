import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API and the socket are proxied so the session cookie stays same-origin in development and in preview.
const proxy = {
  "/api": "http://localhost:4000",
  "/socket.io": { target: "http://localhost:4000", ws: true },
};

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React gets its own small chunk that every page loads. All 3D code (three.js and its helpers)
        // lives in a separate chunk that only the landing scene and the profile build view ever request.
        manualChunks(id) {
          // Vite's own preload helper is needed by the entry, so it must not end up inside the 3D chunk.
          if (id.includes("vite/preload-helper") || id.includes("modulepreload-polyfill")) return "react";
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (/node_modules\/(three|three-stdlib|@react-three|react-reconciler|suspend-react|zustand|its-fine|react-use-measure|maath|meshline|camera-controls|stats\.js|detect-gpu|troika-[a-z-]+|bidi-js|webgl-sdf-generator|@monogrid|@use-gesture|tunnel-rat|utility-types)\//.test(id)) return "three";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  preview: { port: 5173, proxy },
  server: { port: 5173, proxy },
});
