import * as THREE from "three";
import * as Utils from "./FunctionLibrary";
import { World } from "~/world/World";
import { IInputReceiver } from "~/interfaces/IInputReceiver";
import { KeyBinding } from "./KeyBinding";
import { Character } from "~/characters/Character";
import _ from "lodash";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { UIManager } from "./UIManager";
import * as CANNON from "cannon-es";
import { Bullet } from "./Bullet";

export class CameraOperator implements IInputReceiver, IUpdatable {
  public updateOrder: number = 4;

  public world: World;
  public camera: THREE.Camera;
  public target: THREE.Vector3;
  public sensitivity: THREE.Vector2;
  public radius: number = 1;
  public theta: number;
  public phi: number;
  public onMouseDownPosition: THREE.Vector2;
  public onMouseDownTheta: any;
  public onMouseDownPhi: any;
  public targetRadius: number = 1;

  public movementSpeed: number;
  public actions: { [action: string]: KeyBinding };

  public upVelocity: number = 0;
  public forwardVelocity: number = 0;
  public rightVelocity: number = 0;

  public followMode: boolean = false;

  public characterCaller: Character;

  constructor(
    world: World,
    camera: THREE.Camera,
    sensitivityX: number = 1,
    sensitivityY: number = sensitivityX * 0.8
  ) {
    this.world = world;
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.sensitivity = new THREE.Vector2(sensitivityX, sensitivityY);

    this.movementSpeed = 0.06;
    this.radius = 3;
    this.theta = 0;
    this.phi = 0;

    this.onMouseDownPosition = new THREE.Vector2();
    this.onMouseDownTheta = this.theta;
    this.onMouseDownPhi = this.phi;

    this.actions = {
      forward: new KeyBinding("KeyW"),
      back: new KeyBinding("KeyS"),
      left: new KeyBinding("KeyA"),
      right: new KeyBinding("KeyD"),
      up: new KeyBinding("KeyE"),
      down: new KeyBinding("KeyQ"),
      fast: new KeyBinding("ShiftLeft"),
      shoot: new KeyBinding("Mouse0"),
    };

    world.registerUpdatable(this);
  }

  public setSensitivity(
    sensitivityX: number,
    sensitivityY: number = sensitivityX
  ): void {
    this.sensitivity = new THREE.Vector2(sensitivityX, sensitivityY);
  }

  public setRadius(value: number, instantly: boolean = false): void {
    this.targetRadius = Math.max(0.001, value);
    if (instantly === true) {
      this.radius = value;
    }
  }

  public move(deltaX: number, deltaY: number): void {
    this.theta -= deltaX * (this.sensitivity.x / 2);
    this.theta %= 360;
    this.phi += deltaY * (this.sensitivity.y / 2);
    this.phi = Math.min(85, Math.max(-85, this.phi));
  }

  public update(timeScale: number): void {
    if (this.followMode === true) {
      this.camera.position.y = THREE.MathUtils.clamp(
        this.camera.position.y,
        this.target.y,
        Number.POSITIVE_INFINITY
      );
      this.camera.lookAt(this.target);
      let newPos = this.target
        .clone()
        .add(
          new THREE.Vector3()
            .subVectors(this.camera.position, this.target)
            .normalize()
            .multiplyScalar(this.targetRadius)
        );
      this.camera.position.x = newPos.x;
      this.camera.position.y = newPos.y;
      this.camera.position.z = newPos.z;
    } else {
      this.radius = THREE.MathUtils.lerp(this.radius, this.targetRadius, 0.1);

      this.camera.position.x =
        this.target.x +
        this.radius *
          Math.sin((this.theta * Math.PI) / 180) *
          Math.cos((this.phi * Math.PI) / 180);
      this.camera.position.y =
        this.target.y + this.radius * Math.sin((this.phi * Math.PI) / 180);
      this.camera.position.z =
        this.target.z +
        this.radius *
          Math.cos((this.theta * Math.PI) / 180) *
          Math.cos((this.phi * Math.PI) / 180);
      this.camera.updateMatrix();
      this.camera.lookAt(this.target);
    }
  }

  public handleKeyboardEvent(
    event: KeyboardEvent,
    code: string,
    pressed: boolean
  ): void {
    // Free camera
    if (code === "KeyC" && pressed === true && event.shiftKey === true) {
      if (this.characterCaller !== undefined) {
        this.world.inputManager.setInputReceiver(this.characterCaller);
        this.characterCaller = undefined;
      }
    } else {
      for (const action in this.actions) {
        if (this.actions.hasOwnProperty(action)) {
          const binding = this.actions[action];

          if (_.includes(binding.eventCodes, code)) {
            binding.isPressed = pressed;
          }
        }
      }
    }
  }

  public handleMouseWheel(event: WheelEvent, value: number): void {
    this.world.scrollTheTimeScale(value);
  }

  public handleMouseButton(
    event: MouseEvent,
    code: string,
    pressed: boolean
  ): void {
    if (this.inputReceiver !== undefined) {
      this.inputReceiver.handleMouseButton(event, "mouse" + event.button, true);
    }

    // Shooting logic
    if (code === "mouse0" && pressed) { // Trigger only on left mouse button DOWN
        const rayOrigin = new CANNON.Vec3(this.camera.position.x, this.camera.position.y, this.camera.position.z);
        const rayDirection = new THREE.Vector3();
        this.camera.getWorldDirection(rayDirection); // Get camera's forward direction
        const rayEnd = new CANNON.Vec3(
            rayOrigin.x + rayDirection.x * 1000, // Ray length
            rayOrigin.y + rayDirection.y * 1000,
            rayOrigin.z + rayDirection.z * 1000
        );

        const rayResult = new CANNON.RaycastResult();
        const rayOptions = {
            collisionFilterMask: 2, // Target collision group 2 (Characters)
            skipBackfaces: true,
        };

        this.world.physicsManager.physicsWorld.raycastClosest(rayOrigin, rayEnd, rayOptions, rayResult);

        if (rayResult.hasHit) {
            // Find the character associated with the hit body
            for (const character of this.world.characters) {
                if (character.characterCapsule.body === rayResult.body) {
                    console.log("Hit character:", character);
                    // Only remove from world if it's not the main character
                    if (character !== this.world.characters[0]) {
                        this.world.remove(character); // Call World's remove method
                    }
                    break;
                }
            }
        }

        // Create a visual bullet
        const cameraUp = new THREE.Vector3(0, 1, 0); // World up
        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(rayDirection, cameraUp).normalize(); // Camera's right vector
        const cameraLocalUp = new THREE.Vector3();
        cameraLocalUp.crossVectors(cameraRight, rayDirection).normalize(); // Camera's local up vector

        const bulletOrigin = this.camera.position.clone()
            .add(rayDirection.clone().multiplyScalar(0.5)) // Forward offset
            .add(cameraLocalUp.clone().multiplyScalar(-0.05)); // Small downward offset

        new Bullet(this.world, bulletOrigin, rayDirection);
    }
  }

  public handleMouseMove(
    event: MouseEvent,
    deltaX: number,
    deltaY: number
  ): void {
    this.move(deltaX, deltaY);
  }

  public inputReceiverInit(): void {
    this.target.copy(this.camera.position);
    this.setRadius(0, true);
    // this.world.dirLight.target = this.world.camera;

    this.world.updateControls([
      {
        keys: ["W", "S", "A", "D"],
        desc: "Move around",
      },
      {
        keys: ["E", "Q"],
        desc: "Move up / down",
      },
      {
        keys: ["Shift"],
        desc: "Speed up",
      },
      {
        keys: ["Shift", "+", "C"],
        desc: "Exit free camera mode",
      },
      {
        keys: ["Mouse0"],
        desc: "Shoot",
      },
    ]);
    UIManager.setCrosshairVisible(true);
  }

  public inputReceiverUpdate(timeStep: number): void {
    // Set fly speed
    let speed =
      this.movementSpeed *
      (this.actions.fast.isPressed ? timeStep * 600 : timeStep * 60);

    const up = Utils.getUp(this.camera);
    const right = Utils.getRight(this.camera);
    const forward = Utils.getBack(this.camera);

    this.upVelocity = THREE.MathUtils.lerp(
      this.upVelocity,
      +this.actions.up.isPressed - +this.actions.down.isPressed,
      0.3
    );
    this.forwardVelocity = THREE.MathUtils.lerp(
      this.forwardVelocity,
      +this.actions.forward.isPressed - +this.actions.back.isPressed,
      0.3
    );
    this.rightVelocity = THREE.MathUtils.lerp(
      this.rightVelocity,
      +this.actions.right.isPressed - +this.actions.left.isPressed,
      0.3
    );

    this.target.add(up.multiplyScalar(speed * this.upVelocity));
    this.target.add(forward.multiplyScalar(speed * this.forwardVelocity));
    this.target.add(right.multiplyScalar(speed * this.rightVelocity));
  }
}
