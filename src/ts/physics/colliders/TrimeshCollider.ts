import * as CANNON from "cannon-es";
import { Object3D } from "three";
// import { threeToCannon } from "../../../lib/utils/three-to-cannon";
import { ShapeType, threeToCannon } from "three-to-cannon";
import * as Utils from "../../core/FunctionLibrary";
import { ICollider } from "../../interfaces/ICollider";

export class TrimeshCollider implements ICollider {
  public mesh: any;
  public options: any;
  public body: CANNON.Body;
  public debugModel: any;

  constructor(mesh: Object3D, options: any) {
    this.mesh = mesh.clone();

    let defaults = {
      mass: 0,
      position: mesh.position,
      rotation: mesh.quaternion,
      friction: 0.3,
    };
    options = Utils.setDefaults(options, defaults);
    this.options = options;

    let mat = new CANNON.Material("triMat");
    mat.friction = options.friction;
    // mat.restitution = 0.7;

    let result = threeToCannon(this.mesh, { type: ShapeType.MESH });
    // shape['material'] = mat;

    // Add phys sphere
    let physBox = new CANNON.Body({
      mass: options.mass,
      position: options.position,
      quaternion: options.rotation,
      shape: result.shape,
    });

    physBox.material = mat;

    this.body = physBox;
  }
}
