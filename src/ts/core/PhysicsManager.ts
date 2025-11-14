import * as CANNON from "cannon-es";
import { World } from "~/world/World";
import * as THREE from "three";
import * as Utils from "~/core/FunctionLibrary";
import { CollisionGroups } from "~/enums/CollisionGroups";

// Physics Constants
const GRAVITY_Y = -9.81;
const BULLET_TRIMESH_FRICTION = 0.3;
const BULLET_TRIMESH_RESTITUTION = 0.7;

export class PhysicsManager {
  public world: World;
  public physicsWorld: CANNON.World;
  public bodiesToRemove: CANNON.Body[] = [];
  public bulletMaterial: CANNON.Material;
  public trimeshMaterial: CANNON.Material;
  public meteoriteMaterial: CANNON.Material;
  public characterMaterial: CANNON.Material; // New: Character material
  public CollisionGroups = CollisionGroups; // Expose CollisionGroups

  constructor(world: World) {
    this.world = world;
    this.physicsWorld = new CANNON.World();
    this.physicsWorld.gravity.set(0, GRAVITY_Y, 0);
    this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
    this.physicsWorld.allowSleep = true;
    this.bulletMaterial = new CANNON.Material("bulletMaterial");
    this.trimeshMaterial = new CANNON.Material("trimeshMaterial");
    this.meteoriteMaterial = new CANNON.Material("meteoriteMaterial");
    this.characterMaterial = new CANNON.Material("characterMaterial"); // Initialize character material

    const bulletTrimeshContactMaterial = new CANNON.ContactMaterial(
      this.bulletMaterial,
      this.trimeshMaterial,
      {
        friction: BULLET_TRIMESH_FRICTION,
        restitution: BULLET_TRIMESH_RESTITUTION,
      }
    );
    this.physicsWorld.addContactMaterial(bulletTrimeshContactMaterial);

    const meteoriteTrimeshContactMaterial = new CANNON.ContactMaterial(
      this.meteoriteMaterial,
      this.trimeshMaterial,
      {
        friction: 0.3,
        restitution: 0.5,
      }
    );
    this.physicsWorld.addContactMaterial(meteoriteTrimeshContactMaterial);

    const meteoriteMeteoriteContactMaterial = new CANNON.ContactMaterial(
      this.meteoriteMaterial,
      this.meteoriteMaterial,
      {
        friction: 0.5,
        restitution: 0.9,
      }
    );
    this.physicsWorld.addContactMaterial(meteoriteMeteoriteContactMaterial);

    // New: Contact material for character-character collisions
    const characterCharacterContactMaterial = new CANNON.ContactMaterial(
      this.characterMaterial,
      this.characterMaterial,
      {
        friction: 0.1, // Low friction to allow sliding past each other
        restitution: 0.0, // No bounce
      }
    );
    this.physicsWorld.addContactMaterial(characterCharacterContactMaterial);

    // New: Contact material for character-trimesh (ground) collisions
    const characterTrimeshContactMaterial = new CANNON.ContactMaterial(
      this.characterMaterial,
      this.trimeshMaterial,
      {
        friction: 0.0, // Characters should not stick to the ground
        restitution: 0.0, // No bounce
      }
    );
    this.physicsWorld.addContactMaterial(characterTrimeshContactMaterial);

    this.physicsWorld.addEventListener("preStep", () => this._onPreStep());
    this.physicsWorld.addEventListener("postStep", () => this._onPostStep());
  }

  private _onPreStep(): void {
    this.world.characters.forEach((character) => {
      character.physicsPreStep(character.characterCapsule.body, character);
    });
    this.world.vehicles.forEach((vehicle) => {
      vehicle.physicsPreStep(vehicle.collision);
    });
  }

  private _onPostStep(): void {
    this.world.characters.forEach((character) => {
      character.physicsPostStep(character.characterCapsule.body, character);
    });
  }

  public update(timeStep: number): void {
    this._processDeferredBodyRemovals();

    this.physicsWorld.step(this.world.physicsFrameTime, timeStep);

    this.world.characters.forEach((char) => {
      this._handleCharacterOutOfBounds(char);
    });

    this.world.vehicles.forEach((vehicle) => {
      this._handleVehicleOutOfBounds(vehicle);
    });
  }

  private _processDeferredBodyRemovals(): void {
    for (let i = 0; i < this.bodiesToRemove.length; i++) {
      const body = this.bodiesToRemove[i];
      this.physicsWorld.removeBody(body);
      body.world = null; // Explicitly nullify world reference
    }
    this.bodiesToRemove.length = 0; // Clear the list
  }

  private _handleCharacterOutOfBounds(character: Character): void {
    if (this.world.isOutOfBounds(character.characterCapsule.body.position)) {
      this.world.outOfBoundsRespawn(character.characterCapsule.body);
    }
  }

  private _handleVehicleOutOfBounds(vehicle: Vehicle): void {
    if (this.world.isOutOfBounds(vehicle.rayCastVehicle.chassisBody.position)) {
      let worldPos = new THREE.Vector3();
      vehicle.spawnPoint.getWorldPosition(worldPos);
      worldPos.y += 1;
      this.world.outOfBoundsRespawn(
        vehicle.rayCastVehicle.chassisBody,
        Utils.cannonVector(worldPos)
      );
    }
  }
}
