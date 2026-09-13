import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  server: {
    open: true,
    // Bind to 0.0.0.0 (all network interfaces), not just localhost, so a
    // friend on the same LAN/Wi-Fi can reach the dev server directly --
    // Vite prints the actual "Network: http://<lan-ip>:5173/" URL to use
    // once this is on (requires restarting `npm run dev`, not just HMR --
    // this is server bind config, not app code).
    host: true,
  },
  build: {
    outDir: "build",
    sourcemap: true,
    // Consider using manualChunks for code splitting to optimize bundle size
    // and improve initial load times, especially for larger applications.
    // Example:
    // rollupOptions: {
    //   output: {
    //     manualChunks: {
    //       vendor: ['react', 'react-dom'],
    //       // Add other chunks as needed
    //     },
    //   },
    // },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src/ts"),
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
});
