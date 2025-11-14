import "../css/main.css";
import { UIManager } from "./core/UIManager";
import { World } from "~/world/World";
import { io, Socket } from "socket.io-client";
import Swal from "sweetalert2";

let chatSocket: Socket;
let myPlayerId: string | null = null;

export function sendChatMessage(message: string): void {
  if (chatSocket && myPlayerId) {
    chatSocket.emit("chatMessage", { senderId: myPlayerId, message: message });
  }
}

function setupSocketConnection(name: string) {
  chatSocket = io("http://localhost:3000/update");

  chatSocket.on("connect", () => {
    chatSocket.emit("joinGame", name);
  });

  chatSocket.on("setID", (id: string) => {
    myPlayerId = id;

    // Send player updates periodically
    setInterval(() => {
      if (world.player) {
        const playerPosition = world.player.position;
        const playerQuaternion = world.player.quaternion;
        const playerAnimation = world.player.currentAnimation || "idle";

        chatSocket.emit("updatePlayer", {
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

  chatSocket.on("playerData", (players: any[]) => {
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
      if (!serverPlayerIds.has(id)) {
        world.removeNetworkPlayer(id);
      }
    });
  });

  chatSocket.on("chatMessage", (data: { senderId: string; message: string }) => {
    if (data.senderId !== myPlayerId) {
      const networkPlayer = world.networkPlayers.get(data.senderId);
      if (networkPlayer) {
        networkPlayer.displayMessage(data.message);
      }
    }
  });

  chatSocket.on("disconnect", () => {
  });
}

const world = new World("world.glb", setupSocketConnection, sendChatMessage);
UIManager.initMinimap(world);
