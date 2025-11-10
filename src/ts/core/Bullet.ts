import * as THREE from "three";
import * as CANNON from "cannon-es";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { World } from "~/world/World";
import { CollisionGroups } from "~/enums/CollisionGroups";
import { Character } from "~/characters/Character";
import { Explosion } from "~/core/Explosion";
import { EntityType } from "~/enums/EntityType";
import { BulletImpactEffect } from "~/core/BulletImpactEffect";
import { BulletTrail } from "~/core/BulletTrail"; // Added import

export class Bullet extends THREE.Mesh implements IUpdatable {
  public updateOrder: number = 5; // Update after camera and characters

  private world: World;
  private velocity: THREE.Vector3;
  private lifetime: number = 3; // seconds (Increased for more noticeable gravity)
  private age: number = 0;
  private body: CANNON.Body;
  private damage: number = 25; // Damage the bullet deals
  private trail: BulletTrail; // Added property

  constructor(world: World, position: THREE.Vector3, direction: THREE.Vector3) {
    super(
      new THREE.SphereGeometry(0.05, 8, 8), // Small sphere for bullet
      new THREE.MeshBasicMaterial({ color: 0xffff00 }) // Yellow bullet
    );

    this.world = world;
    this.position.copy(position);
    this.velocity = direction.clone().multiplyScalar(40); // Bullet speed (Decreased for more noticeable gravity)

    // Create physics body
    const sphereShape = new CANNON.Sphere(0.05);
    this.body = new CANNON.Body({
      mass: 0.1,
      linearDamping: 0.05, // Added linear damping for air resistance
      material: this.world.physicsManager.bulletMaterial, // Assign bullet material from PhysicsManager
      position: new CANNON.Vec3(position.x, position.y, position.z),
      shape: sphereShape,
      collisionFilterGroup: CollisionGroups.Bullet,
      collisionFilterMask: CollisionGroups.Characters | CollisionGroups.TrimeshColliders | CollisionGroups.Default,
    });
    this.body.velocity.copy(new CANNON.Vec3(this.velocity.x, this.velocity.y, this.velocity.z));
    this.body.addEventListener("collide", this.onCollide);

    this.world.physicsManager.physicsWorld.addBody(this.body);
    this.world.sceneManager.graphicsWorld.add(this);
    this.world.registerUpdatable(this);

    this.trail = new BulletTrail(this.world, this.position); // Initialize BulletTrail
  }

  public update(timeStep: number): void {
    this.age += timeStep;

    // Sync physics body position with mesh position
    this.position.copy(this.body.position as unknown as THREE.Vector3);

    // Update the trail with the current position
    this.trail.addPoint(this.position);

    // Remove if lifetime expired
    if (this.age > this.lifetime) {
      this.removeBullet();
    }
  }

  private onCollide = (event: any) => {
    // Create explosion at the bullet's current position (which is the collision point)
    new Explosion(this.world, this.position.clone());

    // Create bullet impact effect at collision point
    const contactPoint = new THREE.Vector3()
      .copy(event.contact.ni as unknown as THREE.Vector3)
      .negate()
      .multiplyScalar(event.contact.ri.length())
      .add(this.position);
    const contactNormal = new THREE.Vector3().copy(
      event.contact.ni as unknown as THREE.Vector3
    );
    new BulletImpactEffect(this.world, contactPoint, contactNormal);

    // Remove bullet
    this.removeBullet();
  };

  private removeBullet(): void {
    this.world.physicsManager.physicsWorld.removeBody(this.body);
    this.world.sceneManager.graphicsWorld.remove(this);
    this.world.unregisterUpdatable(this);
    this.trail.removeTrail(); // Remove the bullet trail
  }
}