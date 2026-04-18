import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  server: {
    open: true,
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
