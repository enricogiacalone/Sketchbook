import * as THREE from "three";
import { ICharacterAI } from "../../interfaces/ICharacterAI";
import * as Utils from "../../core/FunctionLibrary";
import { Vehicle } from "../../vehicles/Vehicle";
import { Character } from "../Character";
import { Car } from "../../vehicles/Car";
import { EntityType } from "../../enums/EntityType";

export class FollowTarget implements ICharacterAI {
  public character: Character;
  public isTargetReached: boolean;

  public target: THREE.Object3D;
  private stopDistance: number;

  constructor(target: THREE.Object3D, stopDistance: number = 1.3) {
    this.target = target;
    this.stopDistance = stopDistance;
  }

  public setTarget(target: THREE.Object3D): void {
    this.target = target;
  }

  public update(timeStep: number): void {
    if (this.character.controlledObject !== undefined) {
      let source = new THREE.Vector3();
      let target = new THREE.Vector3();

      this.character.getWorldPosition(source);
      this.target.getWorldPosition(target);

      let viewVector = new THREE.Vector3().subVectors(target, source);

      // Follow character
      if (viewVector.length() > this.stopDistance) {
        this.isTargetReached = false;
      } else {
        this.isTargetReached = true;
      }

      let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        (this.character.controlledObject as unknown as THREE.Object3D)
          .quaternion
      );
      viewVector.y = 0;
      viewVector.normalize();
      let angle = Utils.getSignedAngleBetweenVectors(forward, viewVector);

      let goingForward =
        forward.dot(
          Utils.threeVector(
            (this.character.controlledObject as unknown as Vehicle).collision
              .velocity
          )
        ) > 0;
      let speed = (
        this.character.controlledObject as unknown as Vehicle
      ).collision.velocity.length();

      if (forward.dot(viewVector) < 0.0) {
        this.character.controlledObject.triggerAction("reverse", true);
        this.character.controlledObject.triggerAction("throttle", false);
      } else {
        this.character.controlledObject.triggerAction("throttle", true);
        this.character.controlledObject.triggerAction("reverse", false);
      }

      if (Math.abs(angle) > 0.15) {
        if (forward.dot(viewVector) > 0 || goingForward) {
          if (angle > 0) {
            this.character.controlledObject.triggerAction("left", true);
            this.character.controlledObject.triggerAction("right", false);
          } else {
            this.character.controlledObject.triggerAction("right", true);
            this.character.controlledObject.triggerAction("left", false);
          }
        } else {
          if (angle > 0) {
            this.character.controlledObject.triggerAction("right", true);
            this.character.controlledObject.triggerAction("left", false);
          } else {
            this.character.controlledObject.triggerAction("left", true);
            this.character.controlledObject.triggerAction("right", false);
          }
        }
      } else {
        this.character.controlledObject.triggerAction("left", false);
        this.character.controlledObject.triggerAction("right", false);
      }
    } else {
      let targetPosition = new THREE.Vector3();
      let targetVehicle: Vehicle | undefined; // Moved declaration here

      if ((this.target as Character).controlledObject !== undefined) {
        // Main character is in a vehicle, follow the vehicle's world position
        targetVehicle = (this.target as Character).controlledObject as unknown as Vehicle;
        targetVehicle.getWorldPosition(targetPosition);

        // Check for free seats and enter if close enough
        if (this.character.position.distanceTo(targetPosition) < this.stopDistance + 2) { // A bit more distance to enter
          const freeSeat = targetVehicle.seats.find(seat => seat.occupiedBy === null);
          if (freeSeat) {
            // Make AI character enter the vehicle
            this.character.enterVehicle(freeSeat, freeSeat.entryPoints[0]); // Assuming first entry point
            return; // AI character is entering, no need to follow
          }
        }

      } else {
        // Main character is on foot, follow the character's world position
        this.target.getWorldPosition(targetPosition);
      }

      let viewVector = new THREE.Vector3().subVectors(
        targetPosition,
        this.character.position
      );
      this.character.setViewVector(viewVector);

      // Follow character
      if (viewVector.length() > this.stopDistance) {
        this.isTargetReached = false;
        this.character.triggerAction("up", true);
        this.character.speechBubble.showRandomPhrase();
      }
      // Stand still
      else {
        this.isTargetReached = true;
        this.character.triggerAction("up", false);

        // Look at character
        this.character.setOrientation(viewVector);
      }
      this.character.speechBubble.update(timeStep);
    }
  }
}
