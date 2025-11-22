import * as THREE from 'three';
import * as _ from 'lodash';
import { World } from './World';
import { Meteorite } from './Meteorite';
import { AtomicExplosion } from '../core/AtomicExplosion';
import { UFO } from './UFO';
import { Tornado } from './Tornado';

export class WorldEventSpawner {
    private world: World;
    public tornadoes: Tornado[] = []; // Property to manage tornadoes
    private meteorites: Meteorite[] = []; // New array to manage meteorites
    private atomicExplosions: AtomicExplosion[] = []; // New array to manage atomic explosions
    private ufos: UFO[] = []; // New array to manage UFOs

    constructor(world: World) {
        this.world = world;
    }

    public spawnMeteorShower(showerSize: number, basePosition: THREE.Vector3): void {
        for (let i = 0; i < showerSize; i++) {
            const position = basePosition.clone();
            position.x += (Math.random() - 0.5) * 150;
            position.z += (Math.random() - 0.5) * 150;

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 100,
                -100,
                (Math.random() - 0.5) * 100
            );
            const meteorite = new Meteorite(this.world, position, velocity);
            this.meteorites.push(meteorite);
        }
    }

    public spawnAtomicBomb(): void {
        const position = new THREE.Vector3(
            (Math.random() - 0.5) * 8000, // Farther away
            0, // On the ground
            (Math.random() - 0.5) * 8000
        );
        const atomicExplosion = new AtomicExplosion(this.world, position);
        this.atomicExplosions.push(atomicExplosion);
    }

    public spawnUFO(): void {
        const position = new THREE.Vector3(
            (Math.random() - 0.5) * 1000,
            150 + Math.random() * 100, // High in the sky
            (Math.random() - 0.5) * 1000
        );
        const ufo = new UFO(this.world, position);
        this.ufos.push(ufo);
    }

    public spawnTornado(position?: THREE.Vector3): void {
        const spawnPosition = position || new THREE.Vector3(0, 50, 0); // Default position if none provided
        const tornado = new Tornado(this.world, spawnPosition);
        this.tornadoes.push(tornado);
        console.log("Tornado spawned at:", spawnPosition);
    }

    public removeTornado(tornado: Tornado): void {
        tornado.dispose();
        _.pull(this.tornadoes, tornado);
        console.log("Tornado removed.");
    }

    public removeLastTornado(): void {
        if (this.tornadoes.length > 0) {
            const lastTornado = this.tornadoes[this.tornadoes.length - 1];
            this.removeTornado(lastTornado);
        } else {
            console.warn("No tornadoes to remove.");
        }
    }

    public update(timeStep: number): void {
        // Update and clean up meteorites
        for (let i = this.meteorites.length - 1; i >= 0; i--) {
            const meteorite = this.meteorites[i];
            if (meteorite.isRemoved) { // Meteorite self-removes on collision
                this.meteorites.splice(i, 1);
            } else if (meteorite.body.position.y < -100) { // Remove if fallen far below ground
                meteorite.removeFromWorld();
                this.meteorites.splice(i, 1);
            }
        }

        // Update and clean up atomic explosions
        for (let i = this.atomicExplosions.length - 1; i >= 0; i--) {
            const atomicExplosion = this.atomicExplosions[i];
            // Assuming AtomicExplosion will unregister itself from world.updatables when done,
            // we just need to check if it's still registered
            // Or better, AtomicExplosion could have an isDone flag
            if (atomicExplosion.state === "done") { // Assuming AtomicExplosion has a public 'state' property
                this.atomicExplosions.splice(i, 1);
            }
        }

        // Update and clean up UFOs
        for (let i = this.ufos.length - 1; i >= 0; i--) {
            const ufo = this.ufos[i];
            if (ufo.isRemoved) { // UFO self-removes after lifetime
                this.ufos.splice(i, 1);
            }
        }
    }
}
