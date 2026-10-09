import express from "express";
import path from "path";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import sqlite3 from "sqlite3";
import os from "os";

dotenv.config();

const port = process.env.PORT || 3000;

const app = express();
app.use(cors()); // Enable CORS for all routes
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: "*",
  },
});

function getLocalIP() {
  if (process.env.LOCAL_IP) return process.env.LOCAL_IP;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "192.168.1.7";
}

app.get("/api/config", (req, res) => {
  res.json({ ip: getLocalIP(), port: port });
});

app.get("/controller", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "controller.html"));
});

// Database setup
const db = new sqlite3.Database("./gamestate.db", (err) => {
  if (err) {
    console.error("Error opening database", err.message);
  } else {
    console.log("Connected to the SQLite database.");
    db.run(
      `CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        position_x REAL,
        position_y REAL,
        position_z REAL,
        quaternion_w REAL,
        quaternion_x REAL,
        quaternion_y REAL,
        quaternion_z REAL
      )`,
      (err) => {
        if (err) {
          console.error("Error creating table", err.message);
        } else {
          console.log("Characters table is ready.");
        }
      }
    );
  }
});

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'build' directory
app.use(express.static(path.join(process.cwd(), "build")));

// API endpoints for saving and loading game state
app.post("/api/save", (req, res) => {
  const characters = req.body.characters;
  if (!characters || !Array.isArray(characters)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO characters (id, position_x, position_y, position_z, quaternion_w, quaternion_x, quaternion_y, quaternion_z)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    characters.forEach((char) => {
      stmt.run(
        char.id,
        char.position.x,
        char.position.y,
        char.position.z,
        char.quaternion.w,
        char.quaternion.x,
        char.quaternion.y,
        char.quaternion.z
      );
    });
    db.run("COMMIT", (err) => {
      if (err) {
        res.status(500).json({ error: "Failed to commit transaction" });
        console.error("Commit failed", err.message);
      } else {
        res.json({ success: true });
        console.log(`Saved state for ${characters.length} characters.`);
      }
    });
  });
});

app.get("/api/load", (req, res) => {
  db.all("SELECT * FROM characters", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: "Failed to load data" });
      console.error("Error loading data", err.message);
    } else {
      res.json({ characters: rows });
      console.log(`Loaded state for ${rows.length} characters.`);
    }
  });
});

// --- Salvataggi del gioco (SQLite) ------------------------------------------
// "colleghiamo il db per ricordare dove mi trovo, le missioni completate, i
// soldi accumulati e la struttura della citta'":
//  - world: il seme della citta' (src/ts/lib/worldSeed.ts genera sempre la
//    stessa citta' dallo stesso seme); POST /api/world/reseed ne fa una nuova
//  - progress: per giocatore (il nome del menu iniziale) un JSON con
//    posizione, soldi e missioni completate (src/ts/lib/saveGame.ts)
db.run(`CREATE TABLE IF NOT EXISTS world (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.run(
  `CREATE TABLE IF NOT EXISTS progress (player TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`
);

const newSeed = () => Math.floor(Math.random() * 2147483646) + 1;

app.get("/api/world", (req, res) => {
  db.get(`SELECT value FROM world WHERE key = 'seed'`, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) return res.json({ seed: Number(row.value) });
    const seed = newSeed();
    db.run(`INSERT OR IGNORE INTO world (key, value) VALUES ('seed', ?)`, [String(seed)], (e) => {
      if (e) return res.status(500).json({ error: e.message });
      // (se due richieste arrivano insieme vince la prima: la si rilegge)
      db.get(`SELECT value FROM world WHERE key = 'seed'`, [], (e2, r2) =>
        e2 ? res.status(500).json({ error: e2.message }) : res.json({ seed: Number(r2.value) })
      );
    });
  });
});

app.post("/api/world/reseed", (req, res) => {
  const seed = Number.isInteger(req.body?.seed) && req.body.seed > 0 ? req.body.seed : newSeed();
  db.run(`INSERT OR REPLACE INTO world (key, value) VALUES ('seed', ?)`, [String(seed)], (err) =>
    err ? res.status(500).json({ error: err.message }) : res.json({ seed })
  );
});

const validPlayer = (p) => typeof p === "string" && p.length > 0 && p.length <= 40;

app.get("/api/progress/:player", (req, res) => {
  if (!validPlayer(req.params.player)) return res.status(400).json({ error: "nome non valido" });
  db.get(`SELECT data, updated_at FROM progress WHERE player = ?`, [req.params.player], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row ? { data: JSON.parse(row.data), updatedAt: row.updated_at } : { data: null });
  });
});

// PUT (e POST, per navigator.sendBeacon alla chiusura della pagina)
const saveProgress = (req, res) => {
  if (!validPlayer(req.params.player)) return res.status(400).json({ error: "nome non valido" });
  let data = req.body?.data;
  // sendBeacon manda testo semplice
  if (data === undefined && typeof req.body === "string") {
    try {
      data = JSON.parse(req.body).data;
    } catch {
      data = undefined;
    }
  }
  if (!data || typeof data !== "object") return res.status(400).json({ error: "dati mancanti" });
  const json = JSON.stringify(data);
  if (json.length > 20000) return res.status(413).json({ error: "troppo grande" });
  db.run(
    `INSERT INTO progress (player, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(player) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [req.params.player, json, Date.now()],
    (err) => (err ? res.status(500).json({ error: err.message }) : res.json({ success: true }))
  );
};
app.put("/api/progress/:player", saveProgress);
app.post("/api/progress/:player", express.text({ type: "text/plain" }), saveProgress);

// For any other requests, serve the index.html from the 'build' directory
app.use((req, res) => {
  res.sendFile(path.join(process.cwd(), "build", "index.html"));
});

// Update Name Space ----------------------------------------
const updateNameSpace = io.of("/update");

const connectedSockets = new Map();
const colors = [
  "#b52828",
  "#28b528",
  "#2828b5",
  "#b5b528",
  "#b528b5",
  "#28b5b5",
  "#b57f28",
];
let colorIndex = 0;

updateNameSpace.on("connection", (socket) => {
  console.log(`${socket.id} has connected to update namespace`);

  socket.on("joinGame", (name) => {
    const color = colors[colorIndex % colors.length];
    colorIndex++;

    socket.userData = {
      position: { x: 0, y: 10, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      animation: "idle",
      name: name || `Player-${socket.id.substring(0, 4)}`,
      color: color,
    };
    connectedSockets.set(socket.id, socket);
    console.log(`${socket.userData.name} (${socket.id}) has joined the game.`);
    socket.emit("setID", socket.id);
  });

  socket.on("disconnect", () => {
    if (socket.userData) {
      console.log(`${socket.userData.name} (${socket.id}) has disconnected`);
      connectedSockets.delete(socket.id);
    }
  });

  socket.on("updatePlayer", (player) => {
    if (socket.userData) {
      socket.userData.position.x = player.position.x;
      socket.userData.position.y = player.position.y;
      socket.userData.position.z = player.position.z;
      socket.userData.quaternion.x = player.quaternion[0];
      socket.userData.quaternion.y = player.quaternion[1];
      socket.userData.quaternion.z = player.quaternion[2];
      socket.userData.quaternion.w = player.quaternion[3];
      socket.userData.animation = player.animation;
      // manichino: posa dello scheletro (binario, ~370 byte) e arma in mano
      // -- vedi src/ts/components/multiplayer/mannequinPose.ts
      if (player.model) socket.userData.model = player.model;
      if (player.weapon) socket.userData.weapon = player.weapon;
      if (player.pose) socket.userData.pose = player.pose;
      // stato di gioco del manichino (vita, arma, veicolo, drone...): il
      // server non lo interpreta, lo inoltra agli altri
      if (player.ext && typeof player.ext === "object") socket.userData.ext = player.ext;
    }
  });

  // Colpo di un giocatore su un altro: lo decide chi spara/colpisce (lui
  // vede il bersaglio), lo applica il colpito sul proprio manichino.
  socket.on("hit", (hit) => {
    if (!socket.userData || !hit || typeof hit.target !== "string") return;
    const target = connectedSockets.get(hit.target);
    if (target) target.emit("hit", { ...hit, from: socket.id });
  });

  // Sparo (tracciante, lampo, scintille) da far vedere agli altri
  socket.on("shot", (fx) => {
    if (!socket.userData || !fx) return;
    socket.broadcast.emit("shot", { ...fx, from: socket.id });
  });

  socket.on("chatMessage", (data) => {
    // Broadcast the message to all other connected clients
    socket.broadcast.emit("chatMessage", {
      senderId: socket.id,
      message: data.message,
    });
  });

  socket.on("phoneControllerInput", (data) => {
    socket.broadcast.emit("phoneControllerInput", data);
  });
});

// Broadcast all players' data periodically
setInterval(() => {
  const playerData = [];
  for (const s of connectedSockets.values()) {
    playerData.push({
      id: s.id,
      name: s.userData.name,
      color: s.userData.color,
      position_x: s.userData.position.x,
      position_y: s.userData.position.y,
      position_z: s.userData.position.z,
      quaternion_x: s.userData.quaternion.x,
      quaternion_y: s.userData.quaternion.y,
      quaternion_z: s.userData.quaternion.z,
      quaternion_w: s.userData.quaternion.w,
      animation: s.userData.animation,
      model: s.userData.model,
      weapon: s.userData.weapon,
      pose: s.userData.pose,
      ext: s.userData.ext,
    });
  }
  updateNameSpace.emit("playerData", playerData);
}, 50); // 20 updates per second

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
