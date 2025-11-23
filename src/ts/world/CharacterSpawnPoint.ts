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
    loadingManager
      .loadGLTFPromise("boxman.glb")
      .then((model) => {
        
        let player = new Character(model);

        let worldPos = new THREE.Vector3();
        this.object.getWorldPosition(worldPos);
        

        // --- NEW LOGIC FOR GROUND RAYCASTING ---
        const raycastResult = new CANNON.RaycastResult();
        const rayFrom = new CANNON.Vec3(
          worldPos.x,
          worldPos.y + 10,
          worldPos.z
        ); // Start ray slightly above initial spawn height
        const rayTo = new CANNON.Vec3(worldPos.x, worldPos.y - 100, worldPos.z); // Raycast downwards

        if (
          world.physicsManager.physicsWorld.raycastClosest(
            rayFrom,
            rayTo,
            {},
            raycastResult
          )
        ) {
          if (raycastResult.hasHit) {
            worldPos.y = raycastResult.hitPointWorld.y + 1.0; // Spawn a bit higher above the ground hit point to prevent falling through
            
          } else {
            
          }
        } else {
          
        }
        
        // --- END NEW LOGIC ---

        player.setPosition(worldPos.x, worldPos.y, worldPos.z);

        let forward = Utils.getForward(this.object);
        player.setOrientation(forward, true);

        
        world.entityManager.add(player);
        player.takeControl();
        

        if (callback) {
          callback(player);
        }
      })
      .catch((error) => {
        console.error("Error loading character model:", error);
      });
  }
}
