import express from "express";
import path from "path";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import sqlite3 from "sqlite3";

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

// For any other requests, serve the index.html from the 'build' directory
app.get("(.*)", (req, res) => {
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
    }
  });

  socket.on("chatMessage", (data) => {
    // Broadcast the message to all other connected clients
    socket.broadcast.emit("chatMessage", {
      senderId: socket.id,
      message: data.message,
    });
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
    });
  }
  updateNameSpace.emit("playerData", playerData);
}, 50); // 20 updates per second

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
