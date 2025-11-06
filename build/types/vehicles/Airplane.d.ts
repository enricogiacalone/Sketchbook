import * as CANNON from "cannon-es";
import * as THREE from "three";
import { EntityType } from "../enums/EntityType";
import { IControllable } from "../interfaces/IControllable";
import { IWorldEntity } from "../interfaces/IWorldEntity";
import { Vehicle } from "./Vehicle";
export declare class Airplane extends Vehicle implements IControllable, IWorldEntity {
    entityType: EntityType;
    rotor: THREE.Object3D;
    leftAileron: THREE.Object3D;
    rightAileron: THREE.Object3D;
    elevators: THREE.Object3D[];
    rudder: THREE.Object3D;
    private steeringSimulator;
    private aileronSimulator;
    private elevatorSimulator;
    private rudderSimulator;
    private enginePower;
    private lastDrag;
    constructor(gltf: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    physicsPreStepAirplane(body: CANNON.Body): void;
    onInputChange(): void;
    readAirplaneData(gltf: any): void;
    inputReceiverInit(): void;
}
