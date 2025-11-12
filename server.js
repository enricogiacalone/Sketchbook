import express from "express";
import path from "path";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: "*",
  },
});

// Serve static files from the 'build' directory
app.use(express.static(path.join(process.cwd(), "build")));

// For any other requests, serve the index.html from the 'build' directory
app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "build", "index.html"));
});

// Update Name Space ----------------------------------------
const updateNameSpace = io.of("/update");

const connectedSockets = new Map();

updateNameSpace.on("connection", (socket) => {
  socket.userData = {
    position: { x: 0, y: 0, z: 0 }, // Default position
    quaternion: { x: 0, y: 0, z: 0, w: 1 }, // Default quaternion
    animation: "idle", // Default animation
    name: `Player-${socket.id.substring(0, 4)}`, // Default name
    avatarSkin: "default", // Default avatar
  };
  connectedSockets.set(socket.id, socket);

  console.log(`${socket.id} has connected to update namespace`);

  // Send the new player their ID
  socket.emit("setID", socket.id);

  // Send existing players to the new player
  const existingPlayers = [];
  for (const [id, s] of connectedSockets.entries()) {
    if (id !== socket.id) {
      existingPlayers.push({
        id: s.id,
        name: s.userData.name,
        position_x: s.userData.position.x,
        position_y: s.userData.position.y,
        position_z: s.userData.position.z,
        quaternion_x: s.userData.quaternion.x,
        quaternion_y: s.userData.quaternion.y,
        quaternion_z: s.userData.quaternion.z,
        quaternion_w: s.userData.quaternion.w,
        animation: s.userData.animation,
        avatarSkin: s.userData.avatarSkin,
      });
    }
  }
  socket.emit("existingPlayers", existingPlayers);

  socket.on("setName", (name) => {
    socket.userData.name = name;
  });

  socket.on("setAvatar", (avatarSkin) => {
    socket.userData.avatarSkin = avatarSkin;
    // Broadcast avatar change to all clients
    updateNameSpace.emit("playerAvatarChanged", socket.id, avatarSkin);
  });

  socket.on("disconnect", () => {
    console.log(`${socket.id} has disconnected`);
    connectedSockets.delete(socket.id);
    updateNameSpace.emit("removePlayer", socket.id);
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
      socket.userData.avatarSkin = player.avatarSkin;
    }
  });

  // Broadcast all players' data periodically
  setInterval(() => {
    const playerData = [];
    for (const s of connectedSockets.values()) {
      playerData.push({
        id: s.id,
        name: s.userData.name,
        position_x: s.userData.position.x,
        position_y: s.userData.position.y,
        position_z: s.userData.position.z,
        quaternion_x: s.userData.quaternion.x,
        quaternion_y: s.userData.quaternion.y,
        quaternion_z: s.userData.quaternion.z,
        quaternion_w: s.userData.quaternion.w,
        animation: s.userData.animation,
        avatarSkin: s.userData.avatarSkin,
      });
    }
    updateNameSpace.emit("playerData", playerData);
  }, 20); // 50 updates per second
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
