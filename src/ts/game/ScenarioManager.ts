import * as THREE from "three";
import * as _ from "lodash";
import Swal from "sweetalert2";
import { Character } from "~/characters/Character";
import { NetworkPlayer } from "~/characters/NetworkPlayer";
import { EntityType } from "~/enums/EntityType";
import { LoadingManager } from "~/core/LoadingManager";
import { World } from "~/world/World";
import { CharacterSpawnPoint } from "~/world/CharacterSpawnPoint";
import { FollowTarget } from "~/characters/character_ai/FollowTarget";

export class ScenarioManager {
  private world: World;
  private lastScenarioID: string;
  private initialEnemyCount: number = 0;
  private currentEnemyCount: number = 0;
  public scenarioGUIFolder: any;

  constructor(world: World, scenarioGUIFolder: any) {
    this.world = world;
    this.scenarioGUIFolder = scenarioGUIFolder;
  }

  public launchScenario(scenarioID: string): void {
    console.log(`Launching scenario: ${scenarioID}`);
    this.lastScenarioID = scenarioID;

    this.clearEntities();
    this.updateEnemyCountDisplay(); // Initialize enemy count display

    // Launch default scenario
    for (const scenario of this.world.scenarios) {
      if (scenario.id === scenarioID || scenario.spawnAlways) {
        // If it's the default scenario, use hard-coded spawn points for variety
        if (scenario.default) {
          const customSpawnPointsData = [
            { position: new THREE.Vector3(0, 10, 0) },
            { position: new THREE.Vector3(50, 10, 20) },
            { position: new THREE.Vector3(-30, 10, -40) },
            { position: new THREE.Vector3(20, 10, 60) },
            { position: new THREE.Vector3(-60, 10, 10) },
          ];

          const spawnPoints = customSpawnPointsData.map((sp) => {
            const object = new THREE.Object3D();
            object.position.copy(sp.position);
            return new CharacterSpawnPoint(object);
          });

          const randomSpawnPoint =
            spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

          randomSpawnPoint.spawn(
            this.world.loadingManager,
            this.world,
            (player: Character) => {
              player.setColor(new THREE.Color(0x0000ff)); // Set main character color to blue
              this.world.player = player; // Assign the local player
              this.spawnEnemies(5);
            }
          );
        } else {
          // For other scenarios, use the spawn points from the GLTF file
          const playerSpawnPoints: CharacterSpawnPoint[] = [];
          scenario.spawnPoints.forEach((sp) => {
            if (sp instanceof CharacterSpawnPoint) {
              playerSpawnPoints.push(sp);
            }
          });

          if (playerSpawnPoints.length > 0) {
            const randomSpawnPoint =
              playerSpawnPoints[
                Math.floor(Math.random() * playerSpawnPoints.length)
              ];
            randomSpawnPoint.spawn(
              this.world.loadingManager,
              this.world,
              (player: Character) => {
                player.setColor(new THREE.Color(0x0000ff));
                this.world.player = player;
                this.spawnEnemies(5);
              }
            );
          } else {
            scenario.launch(this.world.loadingManager, this.world);
          }
        }
      }
    }
  }

  public restartScenario(): void {
    if (this.lastScenarioID !== undefined) {
      document.exitPointerLock();
      this.launchScenario(this.lastScenarioID);
    } else {
      console.warn("Can't restart scenario. Last scenarioID is undefined.");
    }
  }

  public clearEntities(): void {
    const networkPlayers: NetworkPlayer[] = [];
    for (const character of this.world.characters) {
      if (character instanceof NetworkPlayer) {
        networkPlayers.push(character);
      } else {
        this.world.entityManager.unregisterUpdatable(character);
        if (character.characterCapsule?.body) {
          this.world.physicsManager.bodiesToRemove.push(
            character.characterCapsule.body
          );
        }
        this.world.sceneManager.graphicsWorld.remove(character);
        if (this.world.inputManager.inputReceiver === character) {
          this.world.inputManager.inputReceiver = undefined;
        }
      }
    }
    this.world.characters = networkPlayers;

    for (const vehicle of this.world.vehicles) {
      this.world.entityManager.remove(vehicle);
    }
    this.world.vehicles = [];
  }

  private updateEnemyCountDisplay(): void {
    let enemyCountElement = document.getElementById("dynamic-enemy-count");

    if (!enemyCountElement) {
      enemyCountElement = document.createElement("div");
      enemyCountElement.id = "dynamic-enemy-count";
      enemyCountElement.style.position = "absolute";
      enemyCountElement.style.top = "10px";
      enemyCountElement.style.left = "10px";
      enemyCountElement.style.color = "white";
      enemyCountElement.style.fontSize = "24px";
      enemyCountElement.style.zIndex = "100000";
      enemyCountElement.style.backgroundColor = "rgba(0,0,0,0.5)";
      enemyCountElement.style.padding = "5px";
      enemyCountElement.style.borderRadius = "5px";

      const uiContainer = document.getElementById("ui-container");
      if (uiContainer) {
        uiContainer.appendChild(enemyCountElement);
      } else {
        console.warn(
          "UI container not found, cannot append dynamic enemy count element."
        );
        return;
      }
    }

    if (enemyCountElement) {
      enemyCountElement.innerHTML = `Enemies: ${this.currentEnemyCount}`;
    }
  }

  public spawnEnemies(count: number): void {
    console.log(`Attempting to spawn ${count} enemies.`);
    if (!this.world.player) {
      console.warn("Cannot spawn enemies: local player is not defined.");
      return;
    }

    this.initialEnemyCount = count;
    this.currentEnemyCount = count;
    this.updateEnemyCountDisplay(); // Initialize enemy count display

    for (let i = 0; i < count; i++) {
      this.world.loadingManager
        .loadGLTFPromise("boxman.glb")
        .then((model) => {
          let character = new Character(model);
          character.name = `Enemy ${i}`; // Assign a name for debugging
          character.entityType = EntityType.Enemy; // Assign Enemy EntityType

          character.setBehaviour(new FollowTarget(this.world.player)); // Target the local player
          character.setColor(new THREE.Color(0xff0000)); // Set enemy character color to red
          character.createHealthBar(); // Create health bar for enemies

          let spawnPosition = new THREE.Vector3();
          if (this.world.paths.length > 0) {
            const randomPath =
              this.world.paths[
                Math.floor(Math.random() * this.world.paths.length)
              ];
            const nodeKeys = Object.keys(randomPath.nodes);
            const randomNodeKey =
              nodeKeys[Math.floor(Math.random() * nodeKeys.length)];
            const randomNode = randomPath.nodes[randomNodeKey];
            randomNode.object.getWorldPosition(spawnPosition);
          } else {
            // Fallback to broader random range if no paths are defined
            spawnPosition.x = Math.random() * 800 - 400; // Wider range
            spawnPosition.z = Math.random() * 800 - 400; // Wider range
            spawnPosition.y = 20; // Keep fixed y for now, assume falling into place
            console.log(
              "DEBUG: Procedural world spawnPosition calculated:",
              spawnPosition.x,
              spawnPosition.y,
              spawnPosition.z
            );
          }
          character.setPosition(
            spawnPosition.x,
            spawnPosition.y,
            spawnPosition.z
          );

          this.world.entityManager.add(character);
          console.log(
            `Spawned enemy '${character.name}' at physics body position:`,
            character.characterCapsule.body.position.toArray()
          );
        })
        .catch((error) => {
          console.error("Error loading enemy character model:", error);
        });
    }
  }
}
