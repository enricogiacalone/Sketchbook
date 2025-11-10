import { Character } from "../Character";
import { ICharacterState } from "../../interfaces/ICharacterState";
import { CharacterStateBase } from "./CharacterStateBase";
import * as THREE from "three";
import * as Utils from "../../core/FunctionLibrary";
import { Falling } from "./Falling";
import { getRight, getForward } from "../../core/FunctionLibrary";
import { Idle } from "./Idle";
import { Rolling } from "./Rolling";
import * as CANNON from "cannon-es";

export class Flying extends CharacterStateBase implements ICharacterState {
  private initialGravity: CANNON.Vec3;
  private particleSystem: THREE.Points;

  constructor(character: Character) {
    super(character);

    this.character.velocitySimulator.damping = 0.5;
    this.character.rotationSimulator.damping = 0.5;

    this.character.setArcadeVelocityInfluence(1, 1, 1);

    this.playAnimation("sprint", 0.1);

    this.createWindParticles();

    this.displayControls();
  }

  public update(timeStep: number): void {
    super.update(timeStep);

    // Apply anti-gravity force
    const antiGravityForce = new CANNON.Vec3(0, this.character.characterCapsule.body.mass * 9.81, 0);
    this.character.characterCapsule.body.applyForce(antiGravityForce, this.character.characterCapsule.body.position);

    if (this.character.rayHasHit) {
      this.character.world.sceneManager.graphicsWorld.remove(this.particleSystem);
      this.character.setState(new Rolling(this.character));
      this.character.displayControls();
      return;
    }

    const up = new THREE.Vector3(0, 1, 0);
    const right = Utils.getRight(this.character);
    const forward = Utils.getForward(this.character);

    let upVelocity = 0;
    if (this.character.actions.jump.isPressed) {
      upVelocity = 10;
    } else if (this.character.actions.run.isPressed) {
      upVelocity = -10;
    } else {
      upVelocity = -2; // Descend slowly
    }

    const forwardVelocity =
      +this.character.actions.up.isPressed -
      +this.character.actions.down.isPressed;
    const rightVelocity =
      +this.character.actions.right.isPressed -
      +this.character.actions.left.isPressed;

    const newVelocity = new THREE.Vector3();
    newVelocity.add(up.multiplyScalar(upVelocity));
    newVelocity.add(forward.multiplyScalar(forwardVelocity * 20));
    newVelocity.add(right.multiplyScalar(rightVelocity * 20));

    this.character.characterCapsule.body.velocity.set(
      newVelocity.x,
      newVelocity.y,
      newVelocity.z
    );

    this.character.setCameraRelativeOrientationTarget();

    this.updateWindParticles();

    // FOV
    if (forwardVelocity > 0) {
      (this.character.world.cameraOperator.camera as THREE.PerspectiveCamera).fov = THREE.MathUtils.lerp(
        (this.character.world.cameraOperator.camera as THREE.PerspectiveCamera).fov,
        100,
        0.1
      );
    } else {
      (this.character.world.cameraOperator.camera as THREE.PerspectiveCamera).fov = THREE.MathUtils.lerp(
        (this.character.world.cameraOperator.camera as THREE.PerspectiveCamera).fov,
        80,
        0.1
      );
    }
    (this.character.world.cameraOperator.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }

  public onInputChange(): void {
    super.onInputChange();

    if (this.character.actions.fly.justPressed) {
      this.character.world.sceneManager.graphicsWorld.remove(this.particleSystem);
      this.character.setState(new Idle(this.character));
      this.character.displayControls();
    }
  }

  private displayControls(): void {
    this.character.world.updateControls([
      {
        keys: ["W", "A", "S", "D"],
        desc: "Fly around",
      },
      {
        keys: ["Space"],
        desc: "Fly up",
      },
      {
        keys: ["Shift"],
        desc: "Fly down",
      },
      {
        keys: ["B"],
        desc: "Exit Flight Mode",
      },
    ]);
  }

  private createWindParticles(): void {
    const particles = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particles * 3);

    for (let i = 0; i < particles; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 10;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1,
      transparent: true,
      opacity: 0.5,
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.character.world.sceneManager.graphicsWorld.add(this.particleSystem);
  }

  private updateWindParticles(): void {
    const positions = this.particleSystem.geometry.attributes.position
      .array as Float32Array;
    const characterVelocity = this.character.characterCapsule.body.velocity;

    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 2] += 0.1 + characterVelocity.z / 100;

      if (positions[i + 2] > 5) {
        positions[i + 2] = -5;
      }
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true;
    this.particleSystem.position.copy(this.character.position);
  }
}
