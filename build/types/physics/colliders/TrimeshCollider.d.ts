import * as CANNON from "cannon-es";
import { Object3D } from "three";
import { ICollider } from "../../interfaces/ICollider";
export declare class TrimeshCollider implements ICollider {
    mesh: any;
    options: any;
    body: CANNON.Body;
    debugModel: any;
    constructor(mesh: Object3D, options: any);
}
