
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { World } from './World';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Explosion } from '../core/Explosion';
import { EntityType } from '../enums/EntityType';

export class Meteorite implements IWorldEntity, IUpdatable
{
    public entityType: EntityType = EntityType.Meteorite;

    public position: THREE.Vector3;
    public velocity: THREE.Vector3;
    public mesh: THREE.Mesh;
    public body: CANNON.Body;

    private world: World;
    private isRemoved: boolean = false;

    constructor(world: World, position: THREE.Vector3, velocity: THREE.Vector3)
    {
        this.world = world;
        this.position = position;
        this.velocity = velocity;

        // Model
        const geometry = new THREE.SphereGeometry(0.3, 8, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0xcccccc });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        // Physics
        this.body = new CANNON.Body({
            mass: 5,
            position: new CANNON.Vec3(position.x, position.y, position.z),
            velocity: new CANNON.Vec3(velocity.x, velocity.y, velocity.z),
            shape: new CANNON.Sphere(0.3),
            material: this.world.physicsManager.meteoriteMaterial,
        });
        this.body.allowSleep = false;

        this.body.addEventListener('collide', (event) => this.onCollide(event));

        this.world.sceneManager.graphicsWorld.add(this.mesh);
        this.world.physicsManager.physicsWorld.addBody(this.body);
        this.world.registerUpdatable(this);
    }

    public update(timeStep: number): void
    {
        if (this.isRemoved) return;
        this.position.copy(this.body.position as unknown as THREE.Vector3);
        this.mesh.position.copy(this.body.position as unknown as THREE.Vector3);
        this.mesh.quaternion.copy(this.body.quaternion as unknown as THREE.Quaternion);
    }

    public removeFromWorld(): void
    {
        this.isRemoved = true;
        this.world.sceneManager.graphicsWorld.remove(this.mesh);
        this.world.physicsManager.bodiesToRemove.push(this.body);
        this.world.unregisterUpdatable(this);
    }

    private onCollide(event: any): void
    {
        if (this.isRemoved) return;
        console.log('Meteorite collided!');
        new Explosion(this.world, this.position);
        this.removeFromWorld();
    }
}
