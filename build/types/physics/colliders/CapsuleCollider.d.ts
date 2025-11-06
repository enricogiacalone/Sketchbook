import * as CANNON from "cannon-es";
import * as THREE from "three";
import { ICollider } from "../../interfaces/ICollider";
export declare class CapsuleCollider implements ICollider {
    options: any;
    body: CANNON.Body;
    visual: THREE.Mesh;
    constructor(options: any);
}
