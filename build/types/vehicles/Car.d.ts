import * as CANNON from "cannon-es";
import { EntityType } from "../enums/EntityType";
import { IControllable } from "../interfaces/IControllable";
import { Vehicle } from "./Vehicle";
export declare class Car extends Vehicle implements IControllable {
    entityType: EntityType;
    drive: string;
    get speed(): number;
    private _speed;
    private steeringWheel;
    private airSpinTimer;
    private steeringSimulator;
    private gear;
    private shiftTimer;
    private timeToShift;
    private canTiltForwards;
    private characterWantsToExit;
    constructor(gltf: any);
    noDirectionPressed(): boolean;
    update(timeStep: number): void;
    shiftUp(): void;
    shiftDown(): void;
    physicsPreStepCar(body: CANNON.Body): void;
    onInputChange(): void;
    inputReceiverInit(): void;
    readCarData(gltf: any): void;
}
