import { Minimap } from "./Minimap";
import { World } from "../world/World";

// Constants for HTML element IDs
const UI_CONTAINER_ID = "ui-container";
const LOADING_SCREEN_ID = "loading-screen";
const STATS_ID = "stats";
const DAT_GUI_CONTAINER_ID = "dat-gui-container";
const CROSSHAIR_ID = "crosshair";
const CHAT_INPUT_CONTAINER_ID = "chat-input-container"; // New constant
const CHAT_INPUT_ID = "chat-input"; // New constant

export class UIManager {
  public static minimap: Minimap;

  public static initMinimap(world: World): void {
    this.minimap = new Minimap(world);
  }

  public static createChatInput(): void {
    const uiContainer = document.getElementById(UI_CONTAINER_ID);
    if (!uiContainer) {
      console.error(`UI container with ID ${UI_CONTAINER_ID} not found.`);
      return;
    }

    const chatContainer = document.createElement("div");
    chatContainer.id = CHAT_INPUT_CONTAINER_ID;
    chatContainer.classList.add("collapsed"); // Start collapsed

    const chatInput = document.createElement("input");
    chatInput.id = CHAT_INPUT_ID;
    chatInput.type = "text";
    chatInput.placeholder = "Type message...";

    chatContainer.appendChild(chatInput);
    uiContainer.appendChild(chatContainer);

    // Add event listener to expand/collapse
    chatContainer.addEventListener("click", () => {
      if (chatContainer.classList.contains("collapsed")) {
        UIManager.setChatInputExpanded(true);
      }
    });

    // Add event listener to collapse when clicking outside
    document.addEventListener("click", (event) => {
      if (
        !chatContainer.contains(event.target as Node) &&
        !chatContainer.classList.contains("collapsed")
      ) {
        UIManager.setChatInputExpanded(false);
      }
    });
  }

  public static getChatInput(): HTMLInputElement | null {
    return document.getElementById(CHAT_INPUT_ID) as HTMLInputElement;
  }

  public static setChatInputExpanded(value: boolean): void {
    const chatContainer = document.getElementById(CHAT_INPUT_CONTAINER_ID);
    const chatInput = UIManager.getChatInput();

    if (chatContainer) {
      if (value) {
        chatContainer.classList.remove("collapsed");
        chatContainer.classList.add("expanded");
        if (chatInput) chatInput.focus();
      } else {
        chatContainer.classList.remove("expanded");
        chatContainer.classList.add("collapsed");
        if (chatInput) chatInput.blur();
      }
    }
  }

  public static setUserInterfaceVisible(value: boolean): void {
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
