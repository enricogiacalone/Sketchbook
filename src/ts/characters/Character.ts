import * as CANNON from "cannon-es";
import * as _ from "lodash";
import * as THREE from "three";
import { Object3D } from "three";
import { ClosestObjectFinder } from "~/core/ClosestObjectFinder";
import * as Utils from "~/core/FunctionLibrary";
import { KeyBinding } from "~/core/KeyBinding";
import { CollisionGroups } from "~/enums/CollisionGroups";
import { EntityType } from "~/enums/EntityType";
import { SeatType } from "~/enums/SeatType";
import { ICharacterAI } from "~/interfaces/ICharacterAI";
import { ICharacterState } from "~/interfaces/ICharacterState";
import { IControllable } from "~/interfaces/IControllable";
import { IWorldEntity } from "~/interfaces/IWorldEntity";
import { CapsuleCollider } from "~/physics/colliders/CapsuleCollider";
import { RelativeSpringSimulator } from "~/physics/spring_simulation/RelativeSpringSimulator";
import { VectorSpringSimulator } from "~/physics/spring_simulation/VectorSpringSimulator";
import { Vehicle } from "~/vehicles/Vehicle";
import { VehicleSeat } from "~/vehicles/VehicleSeat";
import { World } from "~/world/World";
import { GroundImpactData } from "~/characters/GroundImpactData";
import { VehicleEntryInstance } from "~/characters/VehicleEntryInstance";
import { Idle } from "~/characters/character_states/Idle";
import { Driving } from "~/characters/character_states/vehicles/Driving";
import { EnteringVehicle } from "~/characters/character_states/vehicles/EnteringVehicle";
import { ExitingAirplane } from "~/characters/character_states/vehicles/ExitingAirplane";
import { ExitingVehicle } from "~/characters/character_states/vehicles/ExitingVehicle";
import { OpenVehicleDoor } from "~/characters/character_states/vehicles/OpenVehicleDoor";
import { Flying } from "~/characters/character_states/Flying";
import { SceneManager } from "~/core/SceneManager";
import { PhysicsManager } from "~/core/PhysicsManager";
import { UIManager } from "~/core/UIManager";
import { Explosion } from "~/core/Explosion"; // Added import // Added import

import { SpeechBubble } from "~/core/SpeechBubble";
import { Bullet } from "../core/Bullet";

export class Character extends THREE.Object3D implements IWorldEntity {
  public updateOrder: number = 1;
  public entityType: EntityType = EntityType.Character;
  private lastShotTime: number = 0;
  private fireRate: number = 0.2; // seconds between shots
  public height: number = 0;
  public tiltContainer: THREE.Group;
  public modelContainer: THREE.Group;
  public materials: THREE.Material[] = [];
  public mixer: THREE.AnimationMixer;
  public animations: any[];
  public speechBubble: SpeechBubble;
  public nameplate: THREE.Sprite;

  // Health
  public maxHealth: number = 100;
  public health: number;
  public isDead: boolean = false;
  public healthBarContainer: THREE.Group;
  public healthBarMesh: THREE.Mesh;
  public healthBarBackgroundMesh: THREE.Mesh;
  private healthBarHideTimeout: any;

  // Movement
  public acceleration: THREE.Vector3 = new THREE.Vector3();
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public arcadeVelocityInfluence: THREE.Vector3 = new THREE.Vector3();
  public velocityTarget: THREE.Vector3 = new THREE.Vector3();
  public arcadeVelocityIsAdditive: boolean = false;

  public defaultVelocitySimulatorDamping: number = 0.8;
  public defaultVelocitySimulatorMass: number = 50;
  public velocitySimulator: VectorSpringSimulator;
  public moveSpeed: number = 4;
  public angularVelocity: number = 0;
  public orientation: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  public orientationTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  public defaultRotationSimulatorDamping: number = 0.5;
  public defaultRotationSimulatorMass: number = 10;
  public rotationSimulator: RelativeSpringSimulator;
  public viewVector: THREE.Vector3;
  public actions: { [action: string]: KeyBinding };
  public characterCapsule: CapsuleCollider;

  // Ray casting
  public rayResult: CANNON.RaycastResult = new CANNON.RaycastResult();
  public rayHasHit: boolean = false;
  public rayCastLength: number = 0.57;
  public raySafeOffset: number = 0.03;
  public wantsToJump: boolean = false;
  public initJumpSpeed: number = -1;
  public groundImpactData: GroundImpactData = new GroundImpactData();
  public raycastBox: THREE.Mesh;

  public world: World;
  public charState: ICharacterState;
  public behaviour: ICharacterAI;

  // Vehicles
  public controlledObject: IControllable;
  public occupyingSeat: VehicleSeat = null;
  public vehicleEntryInstance: VehicleEntryInstance = null;

  private physicsEnabled: boolean = true;

  constructor(gltf: any) {
    super();

    this.readCharacterData(gltf);
    this.setAnimations(gltf.animations);

    // Calculate character height from GLTF scene bounding box
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    this.height = bbox.max.y - bbox.min.y;

    // The visuals group is centered for easy character tilting
    this.tiltContainer = new THREE.Group();
    this.add(this.tiltContainer);

    // Model container is used to reliably ground the character, as animation can alter the position of the model itself
    this.modelContainer = new THREE.Group();
    // this.modelContainer.position.y = -0.57; // This might need adjustment based on actual model
    this.tiltContainer.add(this.modelContainer);
    this.modelContainer.add(gltf.scene);

    this.mixer = new THREE.AnimationMixer(gltf.scene);

    this.speechBubble = new SpeechBubble(this.height); // Pass calculated height
    this.tiltContainer.add(this.speechBubble);

    // Initialize health
    this.health = this.maxHealth;
    console.log(
      `Character ${this.name} initialized with health: ${this.health}`
    );
    console.log("Character object after constructor:", this);
    console.log(
      `Character ${this.name} initialized with health: ${this.health}`
    );

    this.velocitySimulator = new VectorSpringSimulator(
      60,
      this.defaultVelocitySimulatorMass,
      this.defaultVelocitySimulatorDamping
    );
    this.rotationSimulator = new RelativeSpringSimulator(
      60,
      this.defaultRotationSimulatorMass,
      this.defaultRotationSimulatorDamping
    );

    this.viewVector = new THREE.Vector3();

    // Actions
    this.actions = {
      up: new KeyBinding("KeyW"),
      down: new KeyBinding("KeyS"),
      left: new KeyBinding("KeyA"),
      right: new KeyBinding("KeyD"),
      run: new KeyBinding("ShiftLeft"),
      jump: new KeyBinding("Space"),
      use: new KeyBinding("KeyE"),
      enter: new KeyBinding("KeyF"),
      enter_passenger: new KeyBinding("KeyG"),
      seat_switch: new KeyBinding("KeyX"),
      primary: new KeyBinding("Mouse0"),
      secondary: new KeyBinding("Mouse1"),
      fly: new KeyBinding("KeyB"),
    };

    // Physics
    // Player Capsule
    this.characterCapsule = new CapsuleCollider({
      mass: 1,
      position: new CANNON.Vec3(),
      height: 0.5,
      radius: 0.3,
      segments: 8,
      friction: 0.0,
    });
    // capsulePhysics.physical.collisionFilterMask = ~CollisionGroups.Trimesh;
    this.characterCapsule.body.shapes.forEach((shape) => {
      // tslint:disable-next-line: no-bitwise
      shape.collisionFilterMask =
        CollisionGroups.Default |
        CollisionGroups.Characters | // Added this line
        CollisionGroups.TrimeshColliders |
        CollisionGroups.Bullet;
    });
    this.characterCapsule.body.allowSleep = false;

    // Move character to different collision group for raycasting
    this.characterCapsule.body.collisionFilterGroup = 2;

    // Disable character rotation
    this.characterCapsule.body.fixedRotation = true;
    this.characterCapsule.body.updateMassProperties();

    // Ray cast debug
    const boxGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const boxMat = new THREE.MeshLambertMaterial({
      color: 0xff0000,
    });
    this.raycastBox = new THREE.Mesh(boxGeo, boxMat);
    this.raycastBox.visible = false;

    // States
    this.setState(new Idle(this));
  }

  public createNameplate(name: string, color: string): void {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const fontSize = 24;
    context.font = `bold ${fontSize}px Arial`;
    const textWidth = context.measureText(name).width;

    canvas.width = textWidth;
    canvas.height = fontSize;

    context.font = `bold ${fontSize}px Arial`;
    context.fillStyle = color;
    context.fillText(name, 0, fontSize);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({ map: texture });
    this.nameplate = new THREE.Sprite(material);
    this.nameplate.scale.set(textWidth / 100, fontSize / 100, 1);
    this.nameplate.position.y = this.height + 0.5; // Position above health bar

    this.tiltContainer.add(this.nameplate);
  }

  public createHealthBar(): void {
    // Health bar visuals
    this.healthBarContainer = new THREE.Group();
    this.healthBarContainer.position.y = this.height + 0.2; // Position above character's head
    this.healthBarContainer.scale.set(1 / 3, 1 / 3, 1 / 3); // Scale down for better visibility
    this.tiltContainer.add(this.healthBarContainer);

    const healthBarBackgroundGeometry = new THREE.PlaneGeometry(1, 0.1);
    const healthBarBackgroundMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
    }); // Red background
    this.healthBarBackgroundMesh = new THREE.Mesh(
      healthBarBackgroundGeometry,
      healthBarBackgroundMaterial
    );
    this.healthBarBackgroundMesh.position.set(0, 0, 0);
    this.healthBarContainer.add(this.healthBarBackgroundMesh);

    const healthBarGeometry = new THREE.PlaneGeometry(1, 0.1);
    const healthBarMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green health bar
    this.healthBarMesh = new THREE.Mesh(healthBarGeometry, healthBarMaterial);
    this.healthBarMesh.position.set(0, 0, 0.001); // Slightly in front of background
    this.healthBarContainer.add(this.healthBarMesh);

    this.healthBarContainer.visible = false; // Initially hidden
  }

  public setAnimations(animations: []): void {
    this.animations = animations;
  }

  public setArcadeVelocityInfluence(
    x: number,
    y: number = x,
    z: number = x
  ): void {
    this.arcadeVelocityInfluence.set(x, y, z);
  }

  public setViewVector(vector: THREE.Vector3): void {
    this.viewVector.copy(vector).normalize();
  }

  /**
   * Set state to the player. Pass state class (function) name.
   * @param {function} State
   */
  public setState(state: ICharacterState): void {
    this.charState = state;
    this.charState.onInputChange();
  }

  public setPosition(x: number, y: number, z: number): void {
    if (this.physicsEnabled) {
      this.characterCapsule.body.previousPosition = new CANNON.Vec3(x, y, z);
      this.characterCapsule.body.position = new CANNON.Vec3(x, y, z);
      this.characterCapsule.body.interpolatedPosition = new CANNON.Vec3(
        x,
        y,
        z
      );
    } else {
      this.position.x = x;
      this.position.y = y;
      this.position.z = z;
    }
  }

  public resetVelocity(): void {
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;

    this.characterCapsule.body.velocity.x = 0;
    this.characterCapsule.body.velocity.y = 0;
    this.characterCapsule.body.velocity.z = 0;

    this.velocitySimulator.init();
  }

  public setArcadeVelocityTarget(
    velZ: number,
    velX: number = 0,
    velY: number = 0
  ): void {
    this.velocityTarget.z = velZ;
    this.velocityTarget.x = velX;
    this.velocityTarget.y = velY;
  }

  public setOrientation(
    vector: THREE.Vector3,
    instantly: boolean = false
  ): void {
    let lookVector = new THREE.Vector3().copy(vector).setY(0).normalize();
    this.orientationTarget.copy(lookVector);

    if (instantly) {
      this.orientation.copy(lookVector);
    }
  }

  public resetOrientation(): void {
    const forward = Utils.getForward(this);
    this.setOrientation(forward, true);
  }

  public setBehaviour(behaviour: ICharacterAI): void {
    behaviour.character = this;
    this.behaviour = behaviour;
  }

  public setPhysicsEnabled(value: boolean): void {
    this.physicsEnabled = value;

    if (value === true) {
      this.world.physicsManager.physicsWorld.addBody(
        this.characterCapsule.body
      );
    } else {
      this.world.physicsManager.bodiesToRemove.push(this.characterCapsule.body);
    }
  }

  public readCharacterData(gltf: any): void {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        Utils.setupMeshProperties(child);

        if (child.material !== undefined) {
          this.materials.push(child.material);
        }
      }
    });
  }

  public handleKeyboardEvent(
    event: KeyboardEvent,
    code: string,
    pressed: boolean
  ): void {
    if (this.controlledObject !== undefined) {
      this.controlledObject.handleKeyboardEvent(event, code, pressed);
    } else {
      // Free camera
      if (code === "KeyC" && pressed === true && event.shiftKey === true) {
        this.resetControls();
        this.world.cameraOperator.characterCaller = this;
        this.world.inputManager.setInputReceiver(this.world.cameraOperator);
      } else if (
        code === "KeyR" &&
        pressed === true &&
        event.shiftKey === true
      ) {
        this.world.restartScenario();
      } else if (code === "KeyB" && pressed === true) {
        if (this.charState instanceof Flying) {
          this.setState(new Idle(this));
          this.displayControls();
        } else if (!this.rayHasHit) {
          this.setState(new Flying(this));
        }
      } else {
        for (const action in this.actions) {
          if (this.actions.hasOwnProperty(action)) {
            const binding = this.actions[action];

            if (_.includes(binding.eventCodes, code)) {
              this.triggerAction(action, pressed);
            }
          }
        }
      }
    }
  }

  public handleMouseButton(
    event: MouseEvent,
    code: string,
    pressed: boolean
  ): void {
    if (this.controlledObject !== undefined) {
      this.controlledObject.handleMouseButton(event, code, pressed);
    } else {
      for (const action in this.actions) {
        if (this.actions.hasOwnProperty(action)) {
          const binding = this.actions[action];

          if (_.includes(binding.eventCodes, code)) {
            this.triggerAction(action, pressed);
          }
        }
      }
    }
  }

  public handleMouseMove(
    event: MouseEvent,
    deltaX: number,
    deltaY: number
  ): void {
    if (this.controlledObject !== undefined) {
      this.controlledObject.handleMouseMove(event, deltaX, deltaY);
    } else {
      this.world.cameraOperator.move(deltaX, deltaY);
    }
  }

  public handleMouseWheel(event: WheelEvent, value: number): void {
    if (this.controlledObject !== undefined) {
      this.controlledObject.handleMouseWheel(event, value);
    } else {
      this.world.cameraOperator.zoom(value);
    }
  }

  public triggerAction(actionName: string, value: boolean): void {
    // Get action and set it's parameters
    let action = this.actions[actionName];

    if (action.isPressed !== value) {
      // Set value
      action.isPressed = value;

      // Reset the 'just' attributes
      action.justPressed = false;
      action.justReleased = false;

      // Set the 'just' attributes
      if (value) action.justPressed = true;
      else action.justReleased = true;

      // Tell player to handle states according to new input
      this.charState.onInputChange();

      // Reset the 'just' attributes
      action.justPressed = false;
      action.justReleased = false;
    }
  }

  public shoot(): void {
    const now = Date.now() / 1000;
    if (now - this.lastShotTime < this.fireRate) {
      return; // Fire rate limit
    }
    this.lastShotTime = now;

    const bulletPosition = this.position
      .clone()
      .add(this.orientation.clone().multiplyScalar(0.5)) // Start in front of character
      .add(new THREE.Vector3(0, this.height * 0.8, 0)); // At chest height

    new Bullet(this.world, bulletPosition, this.orientation);
  }

  public takeControl(): void {
    if (this.world !== undefined) {
      this.world.inputManager.setInputReceiver(this);
    } else {
      console.warn(
        "Attempting to take control of a character that doesn't belong to a world."
      );
    }
  }

  public resetControls(): void {
    for (const action in this.actions) {
      if (this.actions.hasOwnProperty(action)) {
        this.triggerAction(action, false);
      }
    }
  }

  public takeDamage(damage: number): void {
    if (this.isDead) return; // Prevent taking damage if already dead

    if (this.health === 100) {
      console.log(
        `Character ${this.name} taking ${damage} damage. Initial health was 100.`
      );
    } else {
      console.warn(
        `Character ${this.name} taking ${damage} damage. Initial health was ${this.health} (expected 100).`
      );
    }
    this.health -= damage;
    this.health = Math.max(0, this.health); // Ensure health doesn't go below zero
    console.log(
      `Character ${this.name} new health: ${this.health}. Health bar visible: ${this.healthBarContainer?.visible}`
    );
    console.log(
      `Character ${this.name} healthBarContainer object:`,
      this.healthBarContainer
    );

    // Update health bar
    const healthPercentage = this.health / this.maxHealth;
    this.healthBarMesh.scale.x = healthPercentage;
    this.healthBarMesh.position.x = (healthPercentage - 1) / 2; // Adjust position to scale from left

    this.healthBarContainer.visible = true;

    // Clear previous timeout if exists
    if (this.healthBarHideTimeout) {
      clearTimeout(this.healthBarHideTimeout);
    }

    // Set timeout to hide health bar after 3 seconds, only for non-enemies
    if (this.entityType !== EntityType.Enemy) {
      this.healthBarHideTimeout = setTimeout(() => {
        this.healthBarContainer.visible = false;
      }, 3000); // 3 seconds
    }

    if (this.health <= 0) {
      this.isDead = true; // Mark as dead
      this.removeFromWorld(this.world);
      // Ensure health bar is removed when character is defeated
      if (this.healthBarContainer) {
        this.healthBarContainer.parent?.remove(this.healthBarContainer);
      }
    }
  }

  public update(timeStep: number, unscaledTimeStep: number): void {
    this.behaviour?.update(timeStep);
    this.vehicleEntryInstance?.update(timeStep);
    this.charState?.update(timeStep);

    // this.visuals.position.copy(this.modelOffset);
    if (this.physicsEnabled) this.springMovement(timeStep);
    if (this.physicsEnabled) this.springRotation(timeStep);
    if (this.physicsEnabled) this.rotateModel();
    if (this.mixer !== undefined) this.mixer.update(timeStep);

    // Sync physics/graphics
    if (this.physicsEnabled) {
      this.position.set(
        this.characterCapsule.body.interpolatedPosition.x,
        this.characterCapsule.body.interpolatedPosition.y,
        this.characterCapsule.body.interpolatedPosition.z
      );
    } else {
      let newPos = new THREE.Vector3();
      this.getWorldPosition(newPos);

      this.characterCapsule.body.position.copy(Utils.cannonVector(newPos));
      this.characterCapsule.body.interpolatedPosition.copy(
        Utils.cannonVector(newPos)
      );
    }

    this.updateMatrixWorld();
  }

  public inputReceiverInit(): void {
    if (this.controlledObject !== undefined) {
      this.controlledObject.inputReceiverInit();
      return;
    }

    this.world.cameraOperator.setRadius(1.6, true);
    this.world.cameraOperator.followMode = false;
    // this.world.dirLight.target = this;

    this.displayControls();
    UIManager.setCrosshairVisible(false);
  }

  public displayControls(): void {
    this.world.updateControls([
      {
        keys: ["W", "A", "S", "D"],
        desc: "Movement",
      },
      {
        keys: ["Shift"],
        desc: "Sprint",
      },
      {
        keys: ["Space"],
        desc: "Jump",
      },
      {
        keys: ["F", "or", "G"],
        desc: "Enter vehicle",
      },
      {
        keys: ["Shift", "+", "R"],
        desc: "Respawn",
      },
      {
        keys: ["Shift", "+", "C"],
        desc: "Free camera",
      },
      {
        keys: ["B"],
        desc: "Toggle Flight Mode",
      },
      {
        keys: ["W", "A", "S", "D"],
        desc: "Fly around (in flight mode)",
      },
      {
        keys: ["Space"],
        desc: "Fly up (in flight mode)",
      },
      {
        keys: ["Shift"],
        desc: "Fly down (in flight mode)",
      },
      {
        keys: ["Mouse1"],
        desc: "Exit Flight Mode",
      },
    ]);
  }

  public inputReceiverUpdate(timeStep: number): void {
    if (this.controlledObject !== undefined) {
      this.controlledObject.inputReceiverUpdate(timeStep);
    } else {
      // Look in camera's direction
      this.viewVector = new THREE.Vector3().subVectors(
        this.position,
        this.world.sceneManager.camera.position
      );
      this.getWorldPosition(this.world.cameraOperator.target);
    }
  }

  public setAnimation(clipName: string, fadeIn: number): number {
    if (this.mixer !== undefined) {
      // gltf
      let clip = THREE.AnimationClip.findByName(this.animations, clipName);

      let action = this.mixer.clipAction(clip);
      if (action === null) {
        console.error(`Animation ${clipName} not found!`);
        return 0;
      }

      this.mixer.stopAllAction();
      action.fadeIn(fadeIn);
      action.play();

      return action.getClip().duration;
    }
  }

  public setColor(color: THREE.Color): void {
    this.materials.forEach((material: any) => {
      if (material.color !== undefined) {
        material.color.copy(color);
      }
    });
  }

  public springMovement(timeStep: number): void {
    // Simulator
    this.velocitySimulator.target.copy(this.velocityTarget);
    this.velocitySimulator.simulate(timeStep);

    // Update values
    this.velocity.copy(this.velocitySimulator.position);
    this.acceleration.copy(this.velocitySimulator.velocity);
  }

  public springRotation(timeStep: number): void {
    // Spring rotation
    // Figure out angle between current and target orientation
    let angle = Utils.getSignedAngleBetweenVectors(
      this.orientation,
      this.orientationTarget
    );

    // Simulator
    this.rotationSimulator.target = angle;
    this.rotationSimulator.simulate(timeStep);
    let rot = this.rotationSimulator.position;

    // Updating values
    this.orientation.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.angularVelocity = this.rotationSimulator.velocity;
  }

  public getLocalMovementDirection(): THREE.Vector3 {
    const positiveX = this.actions.right.isPressed ? -1 : 0;
    const negativeX = this.actions.left.isPressed ? 1 : 0;
    const positiveZ = this.actions.up.isPressed ? 1 : 0;
    const negativeZ = this.actions.down.isPressed ? -1 : 0;

    return new THREE.Vector3(
      positiveX + negativeX,
      0,
      positiveZ + negativeZ
    ).normalize();
  }

  public getCameraRelativeMovementVector(): THREE.Vector3 {
    const localDirection = this.getLocalMovementDirection();
    const flatViewVector = new THREE.Vector3(
      this.viewVector.x,
      0,
      this.viewVector.z
    ).normalize();

    return Utils.appplyVectorMatrixXZ(flatViewVector, localDirection);
  }

  public setCameraRelativeOrientationTarget(): void {
    if (this.vehicleEntryInstance === null) {
      let moveVector = this.getCameraRelativeMovementVector();

      if (moveVector.x === 0 && moveVector.y === 0 && moveVector.z === 0) {
        this.setOrientation(this.orientation);
      } else {
        this.setOrientation(moveVector);
      }
    }
  }

  public rotateModel(): void {
    this.lookAt(
      this.position.x + this.orientation.x,
      this.position.y + this.orientation.y,
      this.position.z + this.orientation.z
    );
    this.tiltContainer.rotation.z =
      -this.angularVelocity * 2.3 * this.velocity.length();
    this.tiltContainer.position.setY(
      Math.cos(Math.abs(this.angularVelocity * 2.3 * this.velocity.length())) /
        2 -
        0.5
    );
  }

  public jump(initJumpSpeed: number = -1): void {
    this.wantsToJump = true;
    this.initJumpSpeed = initJumpSpeed;
  }

  public findVehicleToEnter(wantsToDrive: boolean): void {
    // reusable world position variable
    let worldPos = new THREE.Vector3();

    // Find best vehicle
    let vehicleFinder = new ClosestObjectFinder<Vehicle>(this.position, 10);
    this.world.vehicles.forEach((vehicle) => {
      vehicleFinder.consider(vehicle, vehicle.position);
    });

    if (vehicleFinder.closestObject !== undefined) {
      let vehicle = vehicleFinder.closestObject;
      let vehicleEntryInstance = new VehicleEntryInstance(this);
      vehicleEntryInstance.wantsToDrive = wantsToDrive;

      // Find best seat
      let seatFinder = new ClosestObjectFinder<VehicleSeat>(this.position);
      for (const seat of vehicle.seats) {
        if (wantsToDrive) {
          // Consider driver seats
          if (seat.type === SeatType.Driver) {
            seat.seatPointObject.getWorldPosition(worldPos);
            seatFinder.consider(seat, worldPos);
          }
          // Consider passenger seats connected to driver seats
          else if (seat.type === SeatType.Passenger) {
            for (const connSeat of seat.connectedSeats) {
              if (connSeat.type === SeatType.Driver) {
                seat.seatPointObject.getWorldPosition(worldPos);
                seatFinder.consider(seat, worldPos);
                break;
              }
            }
          }
        } else {
          // Consider passenger seats
          if (seat.type === SeatType.Passenger) {
            seat.seatPointObject.getWorldPosition(worldPos);
            seatFinder.consider(seat, worldPos);
          }
        }
      }

      if (seatFinder.closestObject !== undefined) {
        let targetSeat = seatFinder.closestObject;
        vehicleEntryInstance.targetSeat = targetSeat;

        let entryPointFinder = new ClosestObjectFinder<Object3D>(this.position);

        for (const point of targetSeat.entryPoints) {
          point.getWorldPosition(worldPos);
          entryPointFinder.consider(point, worldPos);
        }

        if (entryPointFinder.closestObject !== undefined) {
          vehicleEntryInstance.entryPoint = entryPointFinder.closestObject;
          this.triggerAction("up", true);
          this.vehicleEntryInstance = vehicleEntryInstance;
        }
      }
    }
  }

  public enterVehicle(seat: VehicleSeat, entryPoint: THREE.Object3D): void {
    this.resetControls();

    if (seat.door?.rotation < 0.5) {
      this.setState(new OpenVehicleDoor(this, seat, entryPoint));
    } else {
      this.setState(new EnteringVehicle(this, seat, entryPoint));
    }
  }

  public teleportToVehicle(vehicle: Vehicle, seat: VehicleSeat): void {
    this.resetVelocity();
    this.rotateModel();
    this.setPhysicsEnabled(false);
    (vehicle as unknown as THREE.Object3D).attach(this);

    this.setPosition(
      seat.seatPointObject.position.x,
      seat.seatPointObject.position.y + 0.6,
      seat.seatPointObject.position.z
    );
    this.quaternion.copy(seat.seatPointObject.quaternion);

    this.occupySeat(seat);
    this.setState(new Driving(this, seat));

    this.startControllingVehicle(vehicle, seat);
  }

  public startControllingVehicle(
    vehicle: IControllable,
    seat: VehicleSeat
  ): void {
    if (this.controlledObject !== vehicle) {
      this.transferControls(vehicle);
      this.resetControls();

      this.controlledObject = vehicle;
      this.controlledObject.allowSleep(false);
      vehicle.inputReceiverInit();

      vehicle.controllingCharacter = this;
    }
  }

  public transferControls(entity: IControllable): void {
    // Currently running through all actions of this character and the vehicle,
    // comparing keycodes of actions and based on that triggering vehicle's actions
    // Maybe we should ask input manager what's the current state of the keyboard
    // and read those values... TODO
    for (const action1 in this.actions) {
      if (this.actions.hasOwnProperty(action1)) {
        for (const action2 in entity.actions) {
          if (entity.actions.hasOwnProperty(action2)) {
            let a1 = this.actions[action1];
            let a2 = entity.actions[action2];

            a1.eventCodes.forEach((code1) => {
              a2.eventCodes.forEach((code2) => {
                if (code1 === code2) {
                  entity.triggerAction(action2, a1.isPressed);
                }
              });
            });
          }
        }
      }
    }
  }

  public stopControllingVehicle(): void {
    if (this.controlledObject?.controllingCharacter === this) {
      this.controlledObject.allowSleep(true);
      this.controlledObject.controllingCharacter = undefined;
      this.controlledObject.resetControls();
      this.controlledObject = undefined;
      this.inputReceiverInit();
    }
  }

  public exitVehicle(): void {
    if (this.occupyingSeat !== null) {
      const currentVehicle = this.occupyingSeat.vehicle;

      // If this is the main character, make all other characters in the same vehicle exit
      if (this === this.world.characters[0]) {
        // Check if this is the main character
        this.world.characters.forEach((otherCharacter) => {
          if (
            otherCharacter !== this &&
            otherCharacter.occupyingSeat?.vehicle === currentVehicle
          ) {
            otherCharacter.exitVehicle(); // Call exitVehicle for other characters
          }
        });
      }
      if (this.occupyingSeat.vehicle.entityType === EntityType.Airplane) {
        this.setState(new ExitingAirplane(this, this.occupyingSeat));
      } else {
        this.setState(new ExitingVehicle(this, this.occupyingSeat));
      }

      this.stopControllingVehicle();
    }
  }

  public occupySeat(seat: VehicleSeat): void {
    this.occupyingSeat = seat;
    seat.occupiedBy = this;
  }

  public leaveSeat(): void {
    if (this.occupyingSeat !== null) {
      this.occupyingSeat.occupiedBy = null;
      this.occupyingSeat = null;
    }
  }

  public physicsPreStep(body: CANNON.Body, character: Character): void {
    character.feetRaycast();

    // Raycast debug
    if (character.rayHasHit) {
      if (character.raycastBox.visible) {
        character.raycastBox.position.x = character.rayResult.hitPointWorld.x;
        character.raycastBox.position.y = character.rayResult.hitPointWorld.y;
        character.raycastBox.position.z = character.rayResult.hitPointWorld.z;
      }
    } else {
      if (character.raycastBox.visible) {
        character.raycastBox.position.set(
          body.position.x,
          body.position.y - character.rayCastLength - character.raySafeOffset,
          body.position.z
        );
      }
    }
  }

  public feetRaycast(): void {
    // Player ray casting
    // Create ray
    let body = this.characterCapsule.body;
    const start = new CANNON.Vec3(
      body.position.x,
      body.position.y,
      body.position.z
    );
    const end = new CANNON.Vec3(
      body.position.x,
      body.position.y - this.rayCastLength - this.raySafeOffset,
      body.position.z
    );
    // Raycast options
    const rayCastOptions = {
      collisionFilterMask:
        CollisionGroups.Default | CollisionGroups.TrimeshColliders,
      skipBackfaces: true /* ignore back faces */,
    };
    // Cast the ray
    this.rayHasHit = this.world?.physicsManager.physicsWorld.raycastClosest(
      start,
      end,
      rayCastOptions,
      this.rayResult
    );
  }

  public physicsPostStep(body: CANNON.Body, character: Character): void {
    // Get velocities
    let simulatedVelocity = new THREE.Vector3(
      body.velocity.x,
      body.velocity.y,
      body.velocity.z
    );

    // Take local velocity
    let arcadeVelocity = new THREE.Vector3()
      .copy(character.velocity)
      .multiplyScalar(character.moveSpeed);
    // Turn local into global
    arcadeVelocity = Utils.appplyVectorMatrixXZ(
      character.orientation,
      arcadeVelocity
    );

    let newVelocity = new THREE.Vector3();

    // Additive velocity mode
    if (character.arcadeVelocityIsAdditive) {
      newVelocity.copy(simulatedVelocity);

      let globalVelocityTarget = Utils.appplyVectorMatrixXZ(
        character.orientation,
        character.velocityTarget
      );
      let add = new THREE.Vector3()
        .copy(arcadeVelocity)
        .multiply(character.arcadeVelocityInfluence);

      if (
        Math.abs(simulatedVelocity.x) <
          Math.abs(globalVelocityTarget.x * character.moveSpeed) ||
        Utils.haveDifferentSigns(simulatedVelocity.x, arcadeVelocity.x)
      ) {
        newVelocity.x += add.x;
      }
      if (
        Math.abs(simulatedVelocity.y) <
          Math.abs(globalVelocityTarget.y * character.moveSpeed) ||
        Utils.haveDifferentSigns(simulatedVelocity.y, arcadeVelocity.y)
      ) {
        newVelocity.y += add.y;
      }
      if (
        Math.abs(simulatedVelocity.z) <
          Math.abs(globalVelocityTarget.z * character.moveSpeed) ||
        Utils.haveDifferentSigns(simulatedVelocity.z, arcadeVelocity.z)
      ) {
        newVelocity.z += add.z;
      }
    } else {
      newVelocity = new THREE.Vector3(
        THREE.MathUtils.lerp(
          simulatedVelocity.x,
          arcadeVelocity.x,
          character.arcadeVelocityInfluence.x
        ),
        THREE.MathUtils.lerp(
          simulatedVelocity.y,
          arcadeVelocity.y,
          character.arcadeVelocityInfluence.y
        ),
        THREE.MathUtils.lerp(
          simulatedVelocity.z,
          arcadeVelocity.z,
          character.arcadeVelocityInfluence.z
        )
      );
    }

    // If we're hitting the ground, stick to ground
    if (character.rayHasHit && !(character.charState instanceof Flying)) {
      // Flatten velocity
      newVelocity.y = 0;

      // Move on top of moving objects
      if (character.rayResult.body.mass > 0) {
        let pointVelocity = new CANNON.Vec3();
        character.rayResult.body.getVelocityAtWorldPoint(
          character.rayResult.hitPointWorld,
          pointVelocity
        );
        newVelocity.add(Utils.threeVector(pointVelocity));
      }

      // Measure the normal vector offset from direct "up" vector
      // and transform it into a matrix
      let up = new THREE.Vector3(0, 1, 0);
      let normal = new THREE.Vector3(
        character.rayResult.hitNormalWorld.x,
        character.rayResult.hitNormalWorld.y,
        character.rayResult.hitNormalWorld.z
      );
      let q = new THREE.Quaternion().setFromUnitVectors(up, normal);
      let m = new THREE.Matrix4().makeRotationFromQuaternion(q);

      // Rotate the velocity vector
      newVelocity.applyMatrix4(m);

      // Compensate for gravity
      // newVelocity.y -= body.world.physicsManager.physicsWorld.gravity.y / body.character.world.physicsFrameRate;

      // Apply velocity
      body.velocity.x = newVelocity.x;
      body.velocity.y = newVelocity.y;
      body.velocity.z = newVelocity.z;
      // Ground character
      body.position.y =
        character.rayResult.hitPointWorld.y +
        character.rayCastLength +
        newVelocity.y / character.world.physicsFrameRate;
    } else {
      // If we're in air
      body.velocity.x = newVelocity.x;
      body.velocity.y = newVelocity.y;
      body.velocity.z = newVelocity.z;

      // Save last in-air information
      character.groundImpactData.velocity.x = body.velocity.x;
      character.groundImpactData.velocity.y = body.velocity.y;
      character.groundImpactData.velocity.z = body.velocity.z;
    }

    // Jumping
    if (character.wantsToJump) {
      // If initJumpSpeed is set
      if (character.initJumpSpeed > -1) {
        // Flatten velocity
        body.velocity.y = 0;
        let speed = Math.max(
          character.velocitySimulator.position.length() * 4,
          character.initJumpSpeed
        );
        body.velocity = Utils.cannonVector(
          character.orientation.clone().multiplyScalar(speed)
        );
      } else {
        // Moving objects compensation
        let add = new CANNON.Vec3();
        character.rayResult.body.getVelocityAtWorldPoint(
          character.rayResult.hitPointWorld,
          add
        );
        body.velocity.vsub(add, body.velocity);
      }

      // Add positive vertical velocity
      body.velocity.y += 4;
      // Move above ground by 2x safe offset value
      body.position.y += character.raySafeOffset * 2;
      // Reset flag
      character.wantsToJump = false;
    }
  }

  public addToWorld(world: World): void {
    if (_.includes(world.characters, this)) {
      console.warn("Adding character to a world in which it already exists.");
    } else {
      // Set world
      this.world = world;

      // Register character
      world.characters.push(this);

      // Register physics
      world.physicsManager.physicsWorld.addBody(this.characterCapsule.body);
      this.characterCapsule.body.userData = this; // Set userData for collision detection
      console.log(
        `Character ${this.name} added to world with health: ${this.health}`
      );

      // Create health bar for the character
      this.createHealthBar();

      // Add to graphicsWorld
      console.log(
        `Character ${this.name} (${this.uuid}) properties before adding to graphicsWorld:`
      );
      console.log(`  - this.visible: ${this.visible}`);
      console.log(`  - this.position:`, this.position);
      console.log(`  - this.scale:`, this.scale);
      world.sceneManager.graphicsWorld.add(this);
      world.sceneManager.graphicsWorld.add(this.raycastBox);

      // Shadow cascades
      this.materials.forEach((mat) => {
        world.sky.csm.setupMaterial(mat);
      });
    }
  }

  public removeFromWorld(world: World): void {
    // Delegate removal to the world, which handles enemy count and physics body removal
    world.remove(this);
  }
}
