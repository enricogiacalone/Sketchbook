import { Minimap } from "./Minimap";
import { World } from "../world/World";

// Constants for HTML element IDs
const UI_CONTAINER_ID = "ui-container";
const LOADING_SCREEN_ID = "loading-screen";
const STATS_ID = "stats";
const DAT_GUI_CONTAINER_ID = "dat-gui-container";
const CROSSHAIR_ID = "crosshair";

export class UIManager {
  public static minimap: Minimap;

  public static initMinimap(world: World): void {
    this.minimap = new Minimap(world);
  }

  public static setUserInterfaceVisible(value: boolean): void {
    console.log("UIManager.setUserInterfaceVisible called with:", value);
    document.getElementById(UI_CONTAINER_ID).style.display = value
      ? "block"
      : "none";
  }

  public static setLoadingScreenVisible(value: boolean): void {
    document.getElementById(LOADING_SCREEN_ID).style.display = value
      ? "flex"
      : "none";
  }

  public static setFPSVisible(value: boolean): void {
    document.getElementById(STATS_ID).style.display = value ? "block" : "none";
    document.getElementById(DAT_GUI_CONTAINER_ID).style.top = value
      ? "48px"
      : "0px";
  }

  public static setCrosshairVisible(value: boolean): void {
    const crosshair = document.getElementById(CROSSHAIR_ID);
    if (crosshair) {
      crosshair.style.display = value ? "block" : "none";
    }
  }
}
