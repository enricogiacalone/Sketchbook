import * as THREE from "three";
import * as CANNON from "cannon-es";
import { World } from "./World";
import { IUpdatable } from "../interfaces/IUpdatable";

export class Tornado implements IUpdatable {
  public updateOrder: number = 4;
  public mesh: THREE.Mesh;
  public body: CANNON.Body;
  private world: World;
  private particles: THREE.Points;
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleCount: number = 5000;
  private tornadoHeight: number = 100;
  private tornadoRadius: number = 10;
  private rotationSpeed: number = 5; // Radians per second
  private movementSpeed: number = 5; // Units per second
  private targetPosition: THREE.Vector3;

  constructor(world: World, position: THREE.Vector3) {
    this.world = world;

    // Visuals (Particle System)
    this.particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.particleCount * 3);
    this.particleVelocities = new Float32Array(this.particleCount * 3);

    for (let i = 0; i < this.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * this.tornadoRadius;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (Math.random() - 0.5) * this.tornadoHeight;

      this.particlePositions[i * 3] = x;
      this.particlePositions[i * 3 + 1] = y;
      this.particlePositions[i * 3 + 2] = z;

      this.particleVelocities[i * 3] = 0;
      this.particleVelocities[i * 3 + 1] = 0.1 + Math.random() * 0.5; // Upward velocity
      this.particleVelocities[i * 3 + 2] = 0;
    }

    this.particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.particlePositions, 3)
    );
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0x888888,
      size: 1,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new THREE.Points(
      this.particleGeometry,
      this.particleMaterial
    );
    this.particles.position.copy(position);
    this.world.sceneManager.graphicsWorld.add(this.particles);

    // Physics (Cylinder body for interaction)
    const cylinderShape = new CANNON.Cylinder(
      this.tornadoRadius,
      this.tornadoRadius,
      this.tornadoHeight,
      8
    );
    this.body = new CANNON.Body({
      mass: 0, // Static for now, applies force
      position: new CANNON.Vec3(position.x, position.y, position.z),
      shape: cylinderShape,
      collisionFilterGroup: this.world.physicsManager.CollisionGroups.Tornado,
      collisionFilterMask:
        this.world.physicsManager.CollisionGroups.Default |
        this.world.physicsManager.CollisionGroups.Characters |
        this.world.physicsManager.CollisionGroups.Vehicles,
    });
    this.world.physicsManager.physicsWorld.addBody(this.body);

    this.targetPosition = position.clone();
    this.setRandomTargetPosition();

    this.world.entityManager.registerUpdatable(this);
  }

  private setRandomTargetPosition(): void {
    const range = 200; // Area within which the tornado moves
    this.targetPosition.set(
      (Math.random() - 0.5) * range,
      this.particles.position.y, // Keep y constant for now
      (Math.random() - 0.5) * range
    );
  }

  public update(deltaTime: number): void {
    // Particle animation
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      const i3_1 = i * 3 + 1;
      const i3_2 = i * 3 + 2;

      // Apply upward velocity
      this.particlePositions[i3_1] +=
        this.particleVelocities[i3_1] * deltaTime * 10;

      // Reset particles that go too high
      if (this.particlePositions[i3_1] > this.tornadoHeight / 2) {
        this.particlePositions[i3_1] = -this.tornadoHeight / 2;
        // Give it a new random horizontal position within the radius
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.tornadoRadius;
        this.particlePositions[i3] = Math.cos(angle) * radius;
        this.particlePositions[i3_2] = Math.sin(angle) * radius;
      }

      // Apply swirling motion
      const currentX = this.particlePositions[i3];
      const currentZ = this.particlePositions[i3_2];
      const angle = Math.atan2(currentZ, currentX);
      const radius = Math.sqrt(currentX * currentX + currentZ * currentZ);

      const newAngle = angle + this.rotationSpeed * deltaTime;
      this.particlePositions[i3] = Math.cos(newAngle) * radius;
      this.particlePositions[i3_2] = Math.sin(newAngle) * radius;
    }
    this.particleGeometry.attributes.position.needsUpdate = true;

    // Movement
    const direction = new THREE.Vector3().subVectors(
      this.targetPosition,
      this.particles.position
    );
    if (direction.length() < 5) {
      // If close to target, set a new one
      this.setRandomTargetPosition();
    }
    direction.normalize().multiplyScalar(this.movementSpeed * deltaTime);
    this.particles.position.add(direction);
    this.body.position.copy(this.particles.position as any); // Update physics body position

    // Apply forces to nearby objects
    const tornadoCenter = this.body.position;
    const affectedRadius = this.tornadoRadius * 2; // Larger radius for force application
    const upwardForce = 50; // Force to lift objects
    const swirlForce = 20; // Force to swirl objects

    this.world.physicsManager.physicsWorld.bodies.forEach((otherBody) => {
      if (otherBody.mass > 0 && otherBody !== this.body) {
        // Only affect dynamic bodies
        const distance = tornadoCenter.distanceTo(otherBody.position);

        if (distance < affectedRadius) {
          const forceVector = new CANNON.Vec3();

          // Upward force
          forceVector.y += upwardForce * (1 - distance / affectedRadius);

          // Swirling force
          const dirToBody = new CANNON.Vec3()
            .copy(otherBody.position)
            .vsub(tornadoCenter);
          dirToBody.y = 0; // Only horizontal component
          dirToBody.normalize();

          const swirlDir = new CANNON.Vec3(-dirToBody.z, 0, dirToBody.x); // Perpendicular for swirl
          forceVector.vadd(
            swirlDir.scale(swirlForce * (1 - distance / affectedRadius)),
            forceVector
          );

          otherBody.applyForce(forceVector, otherBody.position);
        }
      }
    });
  }

  public dispose(): void {
    this.world.sceneManager.graphicsWorld.remove(this.particles);
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
    this.world.physicsManager.physicsWorld.removeBody(this.body);
    this.world.entityManager.unregisterUpdatable(this);
  }

  // IUpdatable interface methods
  public addToWorld(world: World): void {}
  public removeFromWorld(world: World): void {}
}
