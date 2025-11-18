import * as CANNON from "cannon-es";
import { Object3D } from "three";
import { threeToCannon } from "~/physics/three-to-cannon";
import * as Utils from "~/core/FunctionLibrary";
import { ICollider } from "~/interfaces/ICollider";
import { CollisionGroups } from "~/enums/CollisionGroups";
import * as THREE from "three";

export class TrimeshCollider implements ICollider {
  public mesh: any;
  public options: any;
  public body: CANNON.Body;
  public debugModel: any;

  constructor(mesh: Object3D, options: any) {
    this.mesh = mesh.clone();

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    mesh.getWorldPosition(worldPos);
    mesh.getWorldQuaternion(worldQuat);

    let defaults = {
      mass: 0,
      position: worldPos,
      rotation: worldQuat,
      friction: 0.3,
    };
    options = Utils.setDefaults(options, defaults);
    this.options = options;

    let mat = new CANNON.Material("triMat");
    mat.friction = options.friction;
    // mat.restitution = 0.7;

    let shape = threeToCannon(this.mesh, { type: "Trimesh" });
    // shape['material'] = mat;

    // Add phys sphere
    let physBox = new CANNON.Body({
      mass: options.mass,
      position: options.position,
      quaternion: options.rotation,
      shape: shape,
    });

    physBox.collisionFilterGroup = CollisionGroups.TrimeshColliders;
    physBox.material = mat;

    this.body = physBox;
  }
}
