import "../css/main.css";
import { UIManager } from "./core/UIManager";
import { World } from "~/world/World";
import { io } from "socket.io-client";

// The application needs a .glb file to load the full world scene.
// The original project contained a .blend file which was likely
// converted to .glb during the Webpack build process.
// This conversion step is missing in the new Vite setup.
//
// To allow the application to start, it is being initialized
// with an empty world.
//
// If you want to load the full world, you need to:
// 1. Manually convert 'src/blend/world.blend' to 'world.glb'.
// 2. Create a 'public' directory in the project root.
// 3. Place 'world.glb' inside the 'public' directory.
// 4. Change the line below from 'new World()' to "new World('world.glb')".
const world = new World("world.glb");
UIManager.initMinimap(world);

// Socket.io Client Setup
const socket = io("http://localhost:3000/update"); // Connect to the update namespace

let myPlayerId: string | null = null;

socket.on("connect", () => {
  console.log("Connected to server with ID:", socket.id);
});

socket.on("setID", (id: string) => {
  myPlayerId = id;
  console.log("My player ID is:", myPlayerId);
  // After the local player is spawned and assigned to world.player,
  // send its initial data to the server.
  if (world.player) {
    const playerPosition = world.player.position;
    const playerQuaternion = world.player.quaternion;
    const playerAnimation = "idle"; // Default animation
    socket.emit("updatePlayer", {
      position: {
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
      },
      quaternion: [
        playerQuaternion.x,
        playerQuaternion.y,
        playerQuaternion.z,
        playerQuaternion.w,
      ],
      animation: playerAnimation,
      name: world.player.name,
      avatarSkin: "default", // Placeholder
    });
  }
});

socket.on("existingPlayers", (players: any[]) => {
  console.log("Existing players:", players);
  players.forEach((playerData) => {
    if (playerData.id !== myPlayerId) {
      world.addNetworkPlayer(playerData.id, playerData);
    }
  });
});

socket.on("playerData", (players: any[]) => {
  players.forEach((playerData) => {
    if (playerData.id === myPlayerId) {
      // This is our own player data, we might use it for reconciliation
      // or just ignore it as our local client is authoritative for our player.
      // For now, we'll just log it.
      // console.log("My updated data:", playerData);
    } else {
      // Update other players' data
      world.updateNetworkPlayer(playerData.id, playerData);
    }
  });
});

socket.on("removePlayer", (id: string) => {
  console.log(`Player ${id} disconnected`);
  world.removeNetworkPlayer(id);
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
});

// Example of sending player updates (this would typically be in your game loop)
// For now, a placeholder. You'll need to get your actual player's position, quaternion, animation.
setInterval(() => {
  if (myPlayerId && world.player) {
    // Assuming world.player exists and has position/quaternion
    const playerPosition = world.player.position;
    const playerQuaternion = world.player.quaternion;
    const playerAnimation = world.player.charState
      ? world.player.charState.constructor.name.toLowerCase()
      : "idle"; // Get current animation state

    socket.emit("updatePlayer", {
      position: {
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
      },
      quaternion: [
        playerQuaternion.x,
        playerQuaternion.y,
        playerQuaternion.z,
        playerQuaternion.w,
      ],
      animation: playerAnimation,
      name: world.player.name,
      avatarSkin: "default", // Placeholder
    });
  }
}, 50); // Send updates 20 times per second
