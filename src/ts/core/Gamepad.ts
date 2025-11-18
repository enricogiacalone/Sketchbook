export class Gamepad {
  private gamepad: any;
  public buttons: any[] = [];
  public axes: number[] = [];

  constructor() {
    window.addEventListener("gamepadconnected", (event) => {
      console.log("Gamepad connected:", event.gamepad);
      this.gamepad = event.gamepad;
    });

    window.addEventListener("gamepaddisconnected", (event) => {
      console.log("Gamepad disconnected:", event.gamepad);
      this.gamepad = null;
    });
  }

  public update(): void {
    // If we don't have a gamepad, check if one is available
    if (!this.gamepad) {
      const gamepads = navigator.getGamepads();
      if (gamepads[0]) {
        this.gamepad = gamepads[0];
      }
    }

    if (this.gamepad) {
      // Get the latest gamepad state
      this.gamepad = navigator.getGamepads()[this.gamepad.index];
      
      // Update button and axis states
      this.buttons = this.gamepad.buttons.map((button: any) => button.pressed);
      this.axes = this.gamepad.axes.map((axis: any) => axis);
    }
  }

  public isButtonPressed(buttonIndex: number): boolean {
    return this.buttons[buttonIndex] || false;
  }

  public getAxisValue(axisIndex: number): number {
    return this.axes[axisIndex] || 0;
  }
}
