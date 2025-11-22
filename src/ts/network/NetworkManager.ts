import * as _ from "lodash";
import { World } from "../world/World";
import { NetworkPlayer } from "../characters/NetworkPlayer";

export class NetworkManager {
  constructor(private world: World) {}

  public sendMessage(message: string): void {
    if (this.world.onSendMessage) {
      this.world.onSendMessage(message);
    }
    if (this.world.player && this.world.player.speechBubble) {
      this.world.player.speechBubble.show(message);
    }
  }

  public async addNetworkPlayer(id: string, playerData: any): Promise<void> {
    console.log(`Attempting to add network player with ID: ${id}`);
    try {
      if (this.world.networkPlayers.has(id)) {
        console.warn(
          `Network player with ID ${id} already exists. Removing old instance.`
        );
        this.removeNetworkPlayer(id);
      }

      const gltf = await this.world.loadingManager.loadGLTFPromise(
        "boxman.glb"
      );
      const networkCharacter = new NetworkPlayer(gltf, this.world, id, playerData);

      networkCharacter.position.set(
        playerData.position_x,
        playerData.position_y,
        playerData.position_z
      );
      networkCharacter.quaternion.set(
        playerData.quaternion_x,
        playerData.quaternion_y,
        playerData.quaternion_z,
        playerData.quaternion_w
      );

      networkCharacter.targetPosition.copy(networkCharacter.position);
      networkCharacter.targetQuaternion.copy(networkCharacter.quaternion);

      this.world.entityManager.add(networkCharacter);
      this.world.networkPlayers.set(id, networkCharacter);
      networkCharacter.createHealthBar();
      console.log(`Successfully added network player with ID: ${id}`);
    } catch (error) {
      console.error(`Failed to add network player ${id}:`, error);
    }
  }

  public updateNetworkPlayer(id: string, playerData: any): void {
    const networkCharacter = this.world.networkPlayers.get(id);
    if (networkCharacter) {
      networkCharacter.updateState(playerData);
    }
  }

  public removeNetworkPlayer(id: string): void {
    console.log(`Attempting to remove network player with ID: ${id}`);
    const networkCharacter = this.world.networkPlayers.get(id);
    if (networkCharacter) {
      _.remove(
        this.world.characters,
        (char) => (char as NetworkPlayer).socketId === id
      );
      this.world.entityManager.remove(networkCharacter);
      this.world.networkPlayers.delete(id);
      console.log(`Successfully removed network player with ID: ${id}`);
    } else {
      console.warn(
        `Attempted to remove non-existent network player with ID: ${id}`
      );
    }
  }
}
