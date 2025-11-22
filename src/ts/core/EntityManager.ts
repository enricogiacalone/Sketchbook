import * as CANNON from "cannon-es";
import * as _ from "lodash";
import Swal from "sweetalert2";
import * as THREE from "three";
import { Character } from "~/characters/Character";
import { NetworkPlayer } from "~/characters/NetworkPlayer";
import { EntityType } from "~/enums/EntityType";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { IWorldEntity } from "~/interfaces/IWorldEntity";
import { World } from "~/world/World"; // Import World

export class EntityManager {
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  public add(worldEntity: IWorldEntity): void {
    worldEntity.addToWorld(this.world);
    if (this.isUpdatable(worldEntity)) {
      this.registerUpdatable(worldEntity);
    }
  }

  public remove(worldEntity: IWorldEntity): void {
    // Special handling for local player death
    if (worldEntity === this.world.player) {
      document.exitPointerLock();
      this.world.player = undefined;

      // Immediately remove player from the world
      this.performRemoval(worldEntity);

      // Then, show respawn modal
      Swal.fire({
        title: "You Died",
        text: "You can rejoin the game.",
        confirmButtonText: "Respawn",
        buttonsStyling: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
      }).then(() => {
        this.world.scenarioManager.restartScenario();
      });

      // Stop further execution for local player death
      return;
    }

    this.performRemoval(worldEntity);
  }

  public registerUpdatable(registree: IUpdatable): void {
    this.world.updatables.push(registree);
    this.world.updatables.sort((a, b) =>
      a.updateOrder > b.updateOrder ? 1 : -1
    );
  }

  public unregisterUpdatable(registree: IUpdatable): void {
    _.pull(this.world.updatables, registree);
  }

  private isUpdatable(entity: IWorldEntity): entity is IUpdatable {
    return (
      (entity as IUpdatable).update !== undefined &&
      (entity as IUpdatable).updateOrder !== undefined
    );
  }

  private performRemoval(worldEntity: IWorldEntity): void {
    console.log("Performing removal for entity:", (worldEntity as any).uuid);

    if (worldEntity instanceof NetworkPlayer) {
      worldEntity.removeFromWorld(this.world);
    } else if (worldEntity instanceof Character) {
      if (worldEntity.entityType === EntityType.Enemy) {
        this.world.scenarioManager.currentEnemyCount--;
        this.world.scenarioManager.updateEnemyCountDisplay(); // Update UI using helper method
        if (this.world.scenarioManager.currentEnemyCount <= 0) {
          // Access initialEnemyCount through scenarioManager
          this.world.scenarioManager.spawnEnemies(
            this.world.scenarioManager.initialEnemyCount * 2
          );
        }
      }

      if (this.world.inputManager.inputReceiver === worldEntity) {
        this.world.inputManager.inputReceiver = undefined;
      }

      _.pull(this.world.characters, worldEntity as Character);

      if (
        (worldEntity as Character).characterCapsule &&
        (worldEntity as Character).characterCapsule.body
      ) {
        (worldEntity as Character).characterCapsule.body.collisionResponse =
          false;
        (worldEntity as Character).characterCapsule.body.mass = 0;
        (worldEntity as Character).characterCapsule.body.sleep();
        this.world.physicsManager.bodiesToRemove.push(
          (worldEntity as Character).characterCapsule.body
        );
      }

      this.world.sceneManager.graphicsWorld.remove(worldEntity as Character);
      console.log(
        `Entity ${(worldEntity as any).uuid} removed from scene graph.`
      );
      if ((worldEntity as Character).raycastBox) {
        this.world.sceneManager.graphicsWorld.remove(
          (worldEntity as Character).raycastBox
        );
      }
      if (
        (worldEntity as Character).healthBarContainer &&
        (worldEntity as Character).healthBarContainer.parent
      ) {
        (worldEntity as Character).healthBarContainer.parent.remove(
          (worldEntity as Character).healthBarContainer
        );
      }
    } else if (worldEntity instanceof Vehicle) {
      worldEntity.removeFromWorld(this.world);
    } else {
    }

    this.unregisterUpdatable(worldEntity);
  }
}
