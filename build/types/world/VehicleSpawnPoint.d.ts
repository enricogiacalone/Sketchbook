import * as THREE from "three";
import { LoadingManager } from "../core/LoadingManager";
import { ISpawnPoint } from "../interfaces/ISpawnPoint";
import { World } from "../world/World";
export declare class VehicleSpawnPoint implements ISpawnPoint {
    type: string;
    driver: string;
    firstAINode: string;
    private object;
    constructor(object: THREE.Object3D);
    spawn(loadingManager: LoadingManager, world: World): void;
    private getNewVehicleByType;
}
