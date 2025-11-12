import "../css/main.css";
import { UIManager } from "./core/UIManager";
import { World } from "~/world/World";
import { io } from "socket.io-client";
import Swal from "sweetalert2";

function setupSocketConnection(name: string) {
  const socket = io("http://localhost:3000/update");

  let myPlayerId: string | null = null;

  socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
    socket.emit("joinGame", name);
  });

  socket.on("setID", (id: string) => {
    myPlayerId = id;
    console.log("My player ID is:", myPlayerId);

    // Send player updates periodically
    setInterval(() => {
      if (world.player) {
        const playerPosition = world.player.position;
        const playerQuaternion = world.player.quaternion;
        const playerAnimation = world.player.charState
          ? world.player.charState.constructor.name.toLowerCase()
          : "idle";

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
        });
      }
    }, 50); // Send updates 20 times per second
  });

  socket.on("playerData", (players: any[]) => {
    const serverPlayerIds = new Set();

    // Add or update players
    players.forEach((playerData) => {
      serverPlayerIds.add(playerData.id);

      if (playerData.id !== myPlayerId) {
        if (!world.networkPlayers.has(playerData.id)) {
          world.addNetworkPlayer(playerData.id, playerData);
        } else {
          world.updateNetworkPlayer(playerData.id, playerData);
        }
      }
    });

    // Remove disconnected players
    world.networkPlayers.forEach((networkPlayer, id) => {
      console.log(
        `Checking local player ${id}. Is it on server?`,
        serverPlayerIds.has(id)
      );
      if (!serverPlayerIds.has(id)) {
        console.log(`Player ${id} is not on server list. Removing.`);
        world.removeNetworkPlayer(id);
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
  });
}

const world = new World("world.glb", setupSocketConnection);
UIManager.initMinimap(world);
