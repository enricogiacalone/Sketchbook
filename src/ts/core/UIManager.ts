export class UIManager {
  public static setUserInterfaceVisible(value: boolean): void {
    console.log("UIManager.setUserInterfaceVisible called with:", value);
    document.getElementById("ui-container").style.display = value
      ? "block"
      : "none";
  }

  public static setLoadingScreenVisible(value: boolean): void {
    document.getElementById("loading-screen").style.display = value
      ? "flex"
      : "none";
  }

  public static setFPSVisible(value: boolean): void {
    document.getElementById("statsBox").style.display = value
      ? "block"
      : "none";
    document.getElementById("dat-gui-container").style.top = value
      ? "48px"
      : "0px";
  }

  public static setCrosshairVisible(value: boolean): void {
    const crosshair = document.getElementById("crosshair");
    if (crosshair) {
        crosshair.style.display = value ? "block" : "none";
    }
  }
}
