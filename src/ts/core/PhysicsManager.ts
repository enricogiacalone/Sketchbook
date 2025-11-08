import * as CANNON from 'cannon-es';
import { World } from '~/world/World';
import * as THREE from 'three';
import * as Utils from '~/core/FunctionLibrary';

export class PhysicsManager {
    public world: World;
    public physicsWorld: CANNON.World;

    constructor(world: World) {
        this.world = world;

        this.physicsWorld = new CANNON.World();
        this.physicsWorld.gravity.set(0, -9.81, 0);
        this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
        this.physicsWorld.allowSleep = true;

        this.physicsWorld.addEventListener('preStep', () => {
            this.world.characters.forEach((character) => {
                character.physicsPreStep(character.characterCapsule.body, character);
            });
            this.world.vehicles.forEach((vehicle) => {
                vehicle.physicsPreStep(vehicle.collision);
            });
        });

        this.physicsWorld.addEventListener('postStep', () => {
            this.world.characters.forEach((character) => {
                character.physicsPostStep(character.characterCapsule.body, character);
            });
        });
    }

    public update(timeStep: number): void {
        this.physicsWorld.step(this.world.physicsFrameTime, timeStep);

        this.world.characters.forEach((char) => {
            if (this.world.isOutOfBounds(char.characterCapsule.body.position)) {
                this.world.outOfBoundsRespawn(char.characterCapsule.body);
            }
        });

        this.world.vehicles.forEach((vehicle) => {
            if (this.world.isOutOfBounds(vehicle.rayCastVehicle.chassisBody.position)) {
                let worldPos = new THREE.Vector3();
                vehicle.spawnPoint.getWorldPosition(worldPos);
                worldPos.y += 1;
                this.world.outOfBoundsRespawn(
                    vehicle.rayCastVehicle.chassisBody,
                    Utils.cannonVector(worldPos)
                );
            }
        });
    }
}
