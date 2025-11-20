import { ISpawnPoint } from "~/interfaces/ISpawnPoint";
import * as THREE from "three";
import { World } from "~/world/World";
import { Character } from "~/characters/Character";
import { LoadingManager } from "~/core/LoadingManager";
import * as Utils from "~/core/FunctionLibrary";
import * as CANNON from "cannon-es"; // Import CANNON

export class CharacterSpawnPoint implements ISpawnPoint {
  private object: THREE.Object3D;

  constructor(object: THREE.Object3D) {
    this.object = object;
  }

  public spawn(
    loadingManager: LoadingManager,
    world: World,
    callback?: (player: Character) => void
  ): void {
    loadingManager.loadGLTFPromise("boxman.glb")
      .then((model) => {
        console.log("CharacterSpawnPoint: Spawning character, model loaded.");
        let player = new Character(model);

        let worldPos = new THREE.Vector3();
        this.object.getWorldPosition(worldPos);
        console.log("CharacterSpawnPoint: Player position before raycast:", worldPos.x, worldPos.y, worldPos.z);

        // --- NEW LOGIC FOR GROUND RAYCASTING ---
        const raycastResult = new CANNON.RaycastResult();
        const rayFrom = new CANNON.Vec3(worldPos.x, worldPos.y + 10, worldPos.z); // Start ray slightly above initial spawn height
        const rayTo = new CANNON.Vec3(worldPos.x, worldPos.y - 100, worldPos.z); // Raycast downwards

        if (world.physicsManager.physicsWorld.raycastClosest(rayFrom, rayTo, {}, raycastResult)) {
          if (raycastResult.hasHit) {
            worldPos.y = raycastResult.hitPointWorld.y + 1.0; // Spawn a bit higher above the ground hit point to prevent falling through
            console.log("CharacterSpawnPoint: Raycast hit:", raycastResult.hasHit, "at", raycastResult.hitPointWorld.y);
          } else {
            console.log("CharacterSpawnPoint: Raycast did not hit anything.");
          }
        } else {
            console.log("CharacterSpawnPoint: Raycast function returned false.");
        }
        console.log("CharacterSpawnPoint: Player position after raycast:", worldPos.x, worldPos.y, worldPos.z);
        // --- END NEW LOGIC ---

        player.setPosition(worldPos.x, worldPos.y, worldPos.z);

        let forward = Utils.getForward(this.object);
        player.setOrientation(forward, true);

        console.log("CharacterSpawnPoint: Adding player to world and taking control.");
        world.add(player);
        player.takeControl();
        console.log("CharacterSpawnPoint: Player instance:", player);

        if (callback) {
          callback(player);
        }
      })
      .catch((error) => {
        console.error("Error loading character model:", error);
      });
  }
}
