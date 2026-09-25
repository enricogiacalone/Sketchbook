import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import fs from "fs";
import type { Plugin } from "vite";

// Laboratorio "cervello mosca" (src/ts/flyLab): il browser addestra e
// salva i pesi in public/fly-brain/ tramite questa rotta del server di
// sviluppo (solo `npm run dev`, non esiste nella build).
function flyBrainSave(): Plugin {
  return {
    name: "fly-brain-save",
    configureServer(server) {
      // lettura diretta dal disco: i file dei pesi sono esclusi dal watcher
      // (vedi server.watch.ignored), quindi quelli creati DOPO l'avvio del
      // server non comparirebbero tra i file pubblici serviti da Vite
      server.middlewares.use("/__flybrain/load", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const task = url.searchParams.get("task") ?? "";
        if (!/^(stand|walk|getup)$/.test(task)) {
          res.statusCode = 400;
          res.end("compito non valido");
          return;
        }
        const b = url.searchParams.get("brain") ?? "";
        const brain = /^shuffled[2-5]?$/.test(b) ? "-" + b : "";
        const file = path.resolve(__dirname, "public/fly-brain", `weights-${task}${brain}.json`);
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(fs.readFileSync(file));
      });
      server.middlewares.use("/__flybrain/save", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? "/", "http://localhost");
        const task = url.searchParams.get("task") ?? "";
        if (!/^(stand|walk|getup)$/.test(task)) {
          res.statusCode = 400;
          res.end("compito non valido");
          return;
        }
        const b = url.searchParams.get("brain") ?? "";
        const brain = /^shuffled[2-5]?$/.test(b) ? "-" + b : "";
        const name = `weights-${task}${brain}${url.searchParams.get("best") ? "-best" : ""}.json`;
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            JSON.parse(body);
            const dir = path.resolve(__dirname, "public/fly-brain");
            fs.writeFileSync(path.join(dir, name + ".tmp"), body);
            fs.renameSync(path.join(dir, name + ".tmp"), path.join(dir, name));
            res.end("ok");
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), flyBrainSave()],
  publicDir: "public",
  server: {
    open: true,
    // Bind to 0.0.0.0 (all network interfaces), not just localhost, so a
    // friend on the same LAN/Wi-Fi can reach the dev server directly --
    // Vite prints the actual "Network: http://<lan-ip>:5173/" URL to use
    // once this is on (requires restarting `npm run dev`, not just HMR --
    // this is server bind config, not app code).
    host: true,
    // i pesi della mosca cambiano ogni pochi secondi durante l'addestramento:
    // non devono ricaricare la pagina
    watch: { ignored: ["**/public/fly-brain/weights-*", "**/training/**"] },
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
