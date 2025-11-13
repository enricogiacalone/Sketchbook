import * as THREE from 'three';
import { World } from '../world/World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { EntityType } from '../enums/EntityType';

export class LaserBeam implements IUpdatable {
    public entityType: EntityType = EntityType.System;
    public updateOrder: number = 2;

    public mesh: THREE.Mesh;
    private world: World;
    private startPoint: THREE.Vector3;
    private endPoint: THREE.Vector3;
    private speed: number = 100; // Units per second
    private lifeTime: number = 0.5; // Seconds
    private currentLifeTime: number = 0;

    constructor(world: World, startPoint: THREE.Vector3, endPoint: THREE.Vector3) {
        this.world = world;
        this.startPoint = startPoint.clone();
        this.endPoint = endPoint.clone();

        const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
        const distance = direction.length();

        const geometry = new THREE.CylinderGeometry(0.2, 0.2, distance, 8);
        geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(0, distance / 2, 0)); // Move origin to bottom
        const material = new THREE.MeshBasicMaterial({ color: 0xFF0000, transparent: true, opacity: 0.8 });
        this.mesh = new THREE.Mesh(geometry, material);

        this.mesh.position.copy(startPoint);
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());

        this.world.sceneManager.graphicsWorld.add(this.mesh);
        this.world.registerUpdatable(this);
    }

    public update(timeStep: number): void {
        this.currentLifeTime += timeStep;

        if (this.currentLifeTime >= this.lifeTime) {
            this.world.unregisterUpdatable(this);
            this.world.sceneManager.graphicsWorld.remove(this.mesh);
        } else {
            // Fade out
            (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - (this.currentLifeTime / this.lifeTime));
        }
    }

    public removeFromWorld(): void {
        // This method is called when the object is removed from the world's updatable list.
        // The actual mesh removal is handled in the update method when lifeTime expires.
    }
}
