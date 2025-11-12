import * as THREE from "three";
import { Character } from "./Character";
import { World } from "~/world/World";
import * as Utils from "~/core/FunctionLibrary";

export class NetworkPlayer extends Character {
  public socketId: string;

  constructor(
    gltf: any,
    world: World,
    socketId: string,
    name: string,
    avatarSkin: string
  ) {
    super(gltf);
    this.tiltContainer.add(this.modelContainer);
    // this.modelContainer.add(gltf.scene); // Temporarily disable GLTF scene
    gltf.scene.visible = false; // Ensure GLTF scene is not visible

    // Add a simple red box as a placeholder
    const geometry = new THREE.BoxGeometry(1, 2, 1); // Adjust size as needed
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red color
    const placeholderMesh = new THREE.Mesh(geometry, material);
    placeholderMesh.position.y = 1; // Position it correctly relative to the character's base
    this.modelContainer.add(placeholderMesh);

    console.log(
      `NetworkPlayer ${this.name} (${this.socketId}) properties after placeholder:`
    );
    console.log(`  - this.visible: ${this.visible}`);
    console.log(`  - this.position:`, this.position);
    console.log(`  - this.scale:`, this.scale);
    console.log(`  - placeholderMesh.visible: ${placeholderMesh.visible}`);
    console.log(`  - placeholderMesh.position:`, placeholderMesh.position);
    console.log(`  - placeholderMesh.scale:`, placeholderMesh.scale);

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.socketId = socketId;
    this.name = name; // Set the player's name
    this.entityType = 1; // Assuming EntityType.NetworkPlayer or similar, if not, use a default
    this.world = world; // Assign the world instance

    // Network players don't need input management or camera operation
    this.inputManager = undefined;
    this.cameraOperator = undefined;

    // Set initial avatar skin if applicable (e.g., change material color or texture)
    this.setAvatarSkin(avatarSkin);

    // Network players don't have physics bodies controlled locally
    // We will directly set their position and quaternion
    this.setPhysicsEnabled(false);
    console.log(
      `NetworkPlayer ${this.name} (${this.socketId}) created at initial position:`,
      this.position
    );
  }

  public update(timeStep: number): void {
    // Network players receive updates from the server, so their position/quaternion
    // are set directly. We only need to update the mixer for animations.
    if (this.mixer !== undefined) {
      this.mixer.update(timeStep);
    }

    // Update speech bubble position
    if (this.speechBubble) {
      this.speechBubble.update(timeStep);
    }
  }

  public setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
  }

  public setQuaternion(x: number, y: number, z: number, w: number): void {
    this.quaternion.set(x, y, z, w);
  }

  public setAvatarSkin(avatarSkin: string): void {
    // This is a placeholder. You would implement logic here to change the
    // character's appearance based on the avatarSkin string.
    // For example, changing material colors, textures, or even swapping models.
    console.log(
      `NetworkPlayer ${this.name} (${this.socketId}) setting avatar skin to: ${avatarSkin}`
    );
    // Example: Change color based on avatarSkin (very basic)
    if (avatarSkin === "red") {
      this.setColor(new THREE.Color(0xff0000));
    } else if (avatarSkin === "green") {
      this.setColor(new THREE.Color(0x00ff00));
    } else if (avatarSkin === "blue") {
      this.setColor(new THREE.Color(0x0000ff));
    } else {
      this.setColor(new THREE.Color(0xffffff)); // Default white
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
  public setPhysicsEnabled(value: boolean): void {
    // For network players, we don't want to add/remove physics bodies
    // as their movement is authoritative from the server.
    // We just set the internal flag.
    // The base Character class's setPhysicsEnabled would add/remove the body,
    // but for NetworkPlayer, we explicitly don't want that.
    // So, we do nothing here or set a local flag if needed.
  }
}
