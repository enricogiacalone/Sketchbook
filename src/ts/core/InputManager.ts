import { World } from "~/world/World";
import { IInputReceiver } from "~/interfaces/IInputReceiver";
import { EntityType } from "~/enums/EntityType";
import { IUpdatable } from "~/interfaces/IUpdatable";
import { Gamepad } from "./Gamepad";

export class InputManager implements IUpdatable {
  public updateOrder: number = 3;

  public world: World;
  public domElement: any;
  public pointerLock: any;
  public isLocked: boolean;
  public inputReceiver: IInputReceiver;
  public gamepad: Gamepad;
  public deadzone: number = 0.1;
  public controlMethod: string = "keyboard"; // Default control method

  public boundOnMouseDown: (evt: any) => void;
  public boundOnMouseMove: (evt: any) => void;
  public boundOnMouseUp: (evt: any) => void;
  public boundOnMouseWheelMove: (evt: any) => void;
  public boundOnPointerlockChange: (evt: any) => void;
  public boundOnPointerlockError: (evt: any) => void;
  public boundOnKeyDown: (evt: any) => void;
  public boundOnKeyUp: (evt: any) => void;

  private worldGUI: WorldGUI; // Add worldGUI property

  constructor(world: World, domElement: HTMLElement, worldGUI: WorldGUI) {
    this.world = world;
    this.domElement = domElement || document.body;
    this.worldGUI = worldGUI; // Assign worldGUI
    this.setPointerLock(this.worldGUI.params.Pointer_Lock); // Use worldGUI.params
    this.isLocked = false;
    this.gamepad = new Gamepad();

    // Bindings for later event use
    // Mouse
    this.boundOnMouseDown = (evt) => this.onMouseDown(evt);
    this.boundOnMouseMove = (evt) => this.onMouseMove(evt);
    this.boundOnMouseUp = (evt) => this.onMouseUp(evt);
    this.boundOnMouseWheelMove = (evt) => this.onMouseWheelMove(evt);

    // Pointer lock
    this.boundOnPointerlockChange = (evt) => this.onPointerlockChange(evt);
    this.boundOnPointerlockError = (evt) => this.onPointerlockError(evt);

    // Keys
    this.boundOnKeyDown = (evt) => this.onKeyDown(evt);
    this.boundOnKeyUp = (evt) => this.onKeyUp(evt);

    // Init event listeners
    // Mouse
    this.domElement.addEventListener("mousedown", this.boundOnMouseDown, false);
    document.addEventListener("wheel", this.boundOnMouseWheelMove, false);
    document.addEventListener(
      "pointerlockchange",
      this.boundOnPointerlockChange,
      false
    );
    document.addEventListener(
      "pointerlockerror",
      this.boundOnPointerlockError,
      false
    );

    // Keys
    document.addEventListener("keydown", this.boundOnKeyDown, false);
    document.addEventListener("keyup", this.boundOnKeyUp, false);

    world.entityManager.registerUpdatable(this);
  }

  public update(timestep: number, unscaledTimeStep: number): void {
    if (
      this.inputReceiver === undefined &&
      this.world !== undefined &&
      this.world.cameraOperator !== undefined
    ) {
      this.setInputReceiver(this.world.cameraOperator);
    }

    if (this.controlMethod === "gamepad") {
      this.gamepad.update();
      this.handleGamepadInput();
    }

    this.inputReceiver?.inputReceiverUpdate(unscaledTimeStep);
  }

  public setControlMethod(method: string): void {
    this.controlMethod = method;
  }

  public handleGamepadInput(): void {
    if (this.inputReceiver === undefined) return;

    // Movement
    let leftStickX = this.gamepad.getAxisValue(0);
    let leftStickY = this.gamepad.getAxisValue(1);

    if (Math.abs(leftStickX) < this.deadzone) leftStickX = 0;
    if (Math.abs(leftStickY) < this.deadzone) leftStickY = 0;

    // Camera
    let rightStickX = this.gamepad.getAxisValue(2);
    let rightStickY = this.gamepad.getAxisValue(3);

    if (Math.abs(rightStickX) < this.deadzone) rightStickX = 0;
    if (Math.abs(rightStickY) < this.deadzone) rightStickY = 0;

    // console.log(`Left Stick: (${leftStickX}, ${leftStickY}) Right Stick: (${rightStickX}, ${rightStickY})`);

    this.inputReceiver.handleKeyboardEvent(null, "KeyW", leftStickY < -0.5);
    this.inputReceiver.handleKeyboardEvent(null, "KeyS", leftStickY > 0.5);
    this.inputReceiver.handleKeyboardEvent(null, "KeyA", leftStickX < -0.5);
    this.inputReceiver.handleKeyboardEvent(null, "KeyD", leftStickX > 0.5);

    this.inputReceiver.handleMouseMove(
      null,
      rightStickX * 20,
      rightStickY * 20
    );

    // Actions
    this.inputReceiver.handleKeyboardEvent(
      null,
      "Space",
      this.gamepad.isButtonPressed(0)
    ); // A button
    this.inputReceiver.handleKeyboardEvent(
      null,
      "ShiftLeft",
      this.gamepad.isButtonPressed(7)
    ); // Right Trigger (R2) for running
    this.inputReceiver.handleMouseButton(
      null,
      "mouse0",
      this.gamepad.isButtonPressed(2)
    ); // X button for mouse0 (primary action)
    this.inputReceiver.handleKeyboardEvent(
      null,
      "KeyF",
      this.gamepad.isButtonPressed(3)
    ); // Triangle button for entering vehicle
    if (this.gamepad.isButtonPressed(5)) {
      if (this.inputReceiver === this.world.cameraOperator) {
        this.inputReceiver.exitFreeCamera();
      } else {
        this.inputReceiver.enterFreeCamera();
      }
    }
    this.inputReceiver.handleKeyboardEvent(
      null,
      "KeyB",
      this.gamepad.isButtonPressed(4)
    ); // L1 for flight mode
  }

  public setInputReceiver(receiver: IInputReceiver): void {
    this.inputReceiver = receiver;
    this.inputReceiver.inputReceiverInit();
  }

  public setPointerLock(enabled: boolean): void {
    this.pointerLock = enabled;
  }

  public onPointerlockChange(event: MouseEvent): void {
    if (document.pointerLockElement === this.domElement) {
      this.domElement.addEventListener(
        "mousemove",
        this.boundOnMouseMove,
        false
      );
      this.domElement.addEventListener("mouseup", this.boundOnMouseUp, false);
      this.isLocked = true;
    } else {
      this.domElement.removeEventListener(
        "mousemove",
        this.boundOnMouseMove,
        false
      );
      this.domElement.removeEventListener(
        "mouseup",
        this.boundOnMouseUp,
        false
      );
      this.isLocked = false;
    }
  }

  public onPointerlockError(event: MouseEvent): void {
    console.error("PointerLockControls: Unable to use Pointer Lock API");
  }

  public onMouseDown(event: MouseEvent): void {
    if (this.pointerLock) {
      this.domElement.requestPointerLock();
    } else {
      this.domElement.addEventListener(
        "mousemove",
        this.boundOnMouseMove,
        false
      );
      this.domElement.addEventListener("mouseup", this.boundOnMouseUp, false);
    }

    if (
      this.inputReceiver !== undefined &&
      this.controlMethod === "keyboard"
    ) {
      this.inputReceiver.handleMouseButton(event, "mouse" + event.button, true);
    }
  }

  public onMouseMove(event: MouseEvent): void {
    if (this.inputReceiver !== undefined) {
      // Allow mouse movement regardless of control method to allow camera control
      this.inputReceiver.handleMouseMove(
        event,
        event.movementX,
        event.movementY
      );
    }
  }

  public onMouseUp(event: MouseEvent): void {
    if (!this.pointerLock) {
      this.domElement.removeEventListener(
        "mousemove",
        this.boundOnMouseMove,
        false
      );
      this.domElement.removeEventListener(
        "mouseup",
        this.boundOnMouseUp,
        false
      );
    }

    if (
      this.inputReceiver !== undefined &&
      this.controlMethod === "keyboard"
    ) {
      this.inputReceiver.handleMouseButton(
        event,
        "mouse" + event.button,
        false
      );
    }
  }

  public onKeyDown(event: KeyboardEvent): void {
    if (this.inputReceiver !== undefined && this.controlMethod === "keyboard") {
      this.inputReceiver.handleKeyboardEvent(event, event.code, true);
    }
  }

  public onKeyUp(event: KeyboardEvent): void {
    if (this.inputReceiver !== undefined && this.controlMethod === "keyboard") {
      this.inputReceiver.handleKeyboardEvent(event, event.code, false);
    }
  }

  public onMouseWheelMove(event: WheelEvent): void {
    if (this.inputReceiver !== undefined && this.controlMethod === "keyboard") {
      this.inputReceiver.handleMouseWheel(event, event.deltaY);
    }
  }
}
