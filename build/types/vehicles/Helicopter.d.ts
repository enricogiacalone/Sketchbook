import * as CANNON from "cannon-es";
import * as THREE from "three";
import { EntityType } from "../enums/EntityType";
import { IControllable } from "../interfaces/IControllable";
import { IWorldEntity } from "../interfaces/IWorldEntity";
import { Vehicle } from "./Vehicle";
export declare class Helicopter extends Vehicle implements IControllable, IWorldEntity {
    entityType: EntityType;
    rotors: THREE.Object3D[];
    private enginePower;
    constructor(gltf: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    onInputChange(): void;
    physicsPreStepHeli(body: CANNON.Body): void;
    readHelicopterData(gltf: any): void;
    inputReceiverInit(): void;
}
