import * as THREE from "three";
import * as _ from "lodash";
import { Character } from "./Character";
import { World } from "~/world/World";
import * as Utils from "~/core/FunctionLibrary";

export class NetworkPlayer extends Character {
  public socketId: string;
  public targetPosition: THREE.Vector3;
  public targetQuaternion: THREE.Quaternion;
  private currentAnimation: string;

  constructor(
    gltf: any,
    world: World,
    socketId: string,
    playerData: any
  ) {
    super(gltf);
    this.tiltContainer.add(this.modelContainer);

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.socketId = socketId;
    this.name = playerData.name;
    this.entityType = 1;
    this.world = world;

    this.inputManager = undefined;
    this.cameraOperator = undefined;

    this.targetPosition = new THREE.Vector3();
    this.targetQuaternion = new THREE.Quaternion();

    this.setColor(new THREE.Color(playerData.color));
    this.createNameplate(playerData.name, playerData.color);

    this.setPhysicsEnabled(false);
  }

  public addToWorld(world: World): void {
    if (_.includes(world.characters, this)) {
      console.warn("Adding character to a world in which it already exists.");
      return;
    }

    // Set world
    this.world = world;

    // Register character
    world.characters.push(this);

    // Add to graphicsWorld
    world.sceneManager.graphicsWorld.add(this);
    world.sceneManager.graphicsWorld.add(this.raycastBox);

    // Shadow cascades
    this.materials.forEach((mat) => {
      world.sky.csm.setupMaterial(mat);
    });
  }

  public update(timeStep: number, unscaledTimeStep: number): void {
    if (this.mixer !== undefined) {
      this.mixer.update(timeStep);
    }

    // Interpolate position and rotation
    this.position.lerp(this.targetPosition, 0.1);
    this.quaternion.slerp(this.targetQuaternion, 0.1);

    if (this.speechBubble) {
      this.speechBubble.update(timeStep);
    }
  }

  public updateState(data: any): void {
    this.targetPosition.set(data.position_x, data.position_y, data.position_z);
    this.targetQuaternion.set(
      data.quaternion_x,
      data.quaternion_y,
      data.quaternion_z,
      data.quaternion_w
    );

    if (this.currentAnimation !== data.animation) {
      this.currentAnimation = data.animation;
      this.setAnimation(data.animation, 0.2);
    }
  }

  public setAvatarSkin(avatarSkin: string): void {
    console.log(
      `NetworkPlayer ${this.name} (${this.socketId}) setting avatar skin to: ${avatarSkin}`
    );
    if (avatarSkin === "red") {
      this.setColor(new THREE.Color(0xff0000));
    } else if (avatarSkin === "green") {
      this.setColor(new THREE.Color(0x00ff00));
    } else if (avatarSkin === "blue") {
      this.setColor(new THREE.Color(0x0000ff));
    } else {
      this.setColor(new THREE.Color(0xffffff));
    }
  }

  // Override methods that are not relevant for network players
  public handleKeyboardEvent(): void {}
  public handleMouseButton(): void {}
  public handleMouseMove(): void {}
  public handleMouseWheel(): void {}
  public triggerAction(): void {}
  public takeControl(): void {}
  public resetControls(): void {}
  public displayControls(): void {}
  public inputReceiverInit(): void {}
  public inputReceiverUpdate(): void {}
  public setPhysicsEnabled(value: boolean): void {}
}
