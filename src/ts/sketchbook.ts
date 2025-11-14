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

// --- Save/Load Logic ---

const saveButton = document.getElementById("save-button");
const loadButton = document.getElementById("load-button");

async function saveState() {
  if (!world.player) {
    console.error("Player not initialized yet.");
    return;
  }

  const charactersToSave = [];

  // Add the main player
  charactersToSave.push({
    id: myPlayerId, // The player's socket ID
    position: world.player.position,
    quaternion: world.player.quaternion,
  });

  // Add other characters (if any) - assuming they have a unique ID property
  // You might need to adjust this depending on how NPCs or other entities are managed.
  world.characters.forEach((char) => {
    // Avoid duplicating the player if they are in the characters list with a different ID
    if (char.uuid !== world.player.uuid && char.charId) {
      charactersToSave.push({
        id: char.charId,
        position: char.position,
        quaternion: char.quaternion,
      });
    }
  });

  try {
    const response = await fetch("http://localhost:3000/api/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ characters: charactersToSave }),
    });

    if (response.ok) {
      Swal.fire({
        title: "Salvato!",
        text: "Lo stato della partita è stato salvato.",
        icon: "success",
        timer: 2000,
        showConfirmButton: false,
      });
    } else {
      throw new Error("Failed to save state");
    }
  } catch (error) {
    console.error("Error saving game state:", error);
    Swal.fire({
      title: "Errore",
      text: "Impossibile salvare lo stato della partita.",
      icon: "error",
    });
  }
}

async function loadState() {
  try {
    const response = await fetch("http://localhost:3000/api/load");
    const data = await response.json();

    if (data.characters) {
      data.characters.forEach((charData: any) => {
        // Find the character in the world and update it
        let character = null;

        if (charData.id === myPlayerId) {
          character = world.player;
        } else {
          // Find other characters by their ID
          character = world.characters.find((c) => c.charId === charData.id);
        }

        if (character) {
          character.setPosition(
            charData.position_x,
            charData.position_y,
            charData.position_z
          );
          character.quaternion.set(
            charData.quaternion_x,
            charData.quaternion_y,
            charData.quaternion_z,
            charData.quaternion_w
          );
        }
      });

      Swal.fire({
        title: "Caricato!",
        text: "Lo stato della partita è stato caricato.",
        icon: "success",
        timer: 2000,
        showConfirmButton: false,
      });
    }
  } catch (error) {
    console.error("Error loading game state:", error);
    Swal.fire({
      title: "Errore",
      text: "Impossibile caricare lo stato della partita.",
      icon: "error",
    });
  }
}

if (saveButton && loadButton) {
  saveButton.addEventListener("click", saveState);
  loadButton.addEventListener("click", loadState);
}
