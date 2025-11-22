import { World } from "~/world/World"; // Import World
import { UIManager } from "~/core/UIManager"; // Import UIManager
import { InputManager } from "~/core/InputManager"; // Import InputManager

export class WorldUIManager {
    private world: World;
    private inputManager: InputManager; // Assuming InputManager is needed for _initializeChatInput

    constructor(world: World, inputManager: InputManager) {
        this.world = world;
        this.inputManager = inputManager;
    }

    public generateHTML(): void {
        // Fonts
        const fontLink1 = document.createElement("link");
        fontLink1.href =
            "https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap";
        fontLink1.rel = "stylesheet";
        document.head.appendChild(fontLink1);

        const fontLink2 = document.createElement("link");
        fontLink2.href =
            "https://fonts.googleapis.com/css2?family=Solway:wght@400;500;700&display=swap";
        fontLink2.rel = "stylesheet";
        document.head.appendChild(fontLink2);

        const fontLink3 = document.createElement("link");
        fontLink3.href =
            "https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap";
        fontLink3.rel = "stylesheet";
        document.head.appendChild(fontLink3);

        // Loader
        const loadingScreenDiv = document.createElement("div");
        loadingScreenDiv.id = "loading-screen";
        loadingScreenDiv.innerHTML = `
      <div id="loading-screen-background"></div>
      <h1 id="main-title" class="sb-font">Sketchbook 0.4</h1>
      <div class="cubeWrap">
        <div class="cube">
          <div class="faces1"></div>
          <div class="faces2"></div>     
        </div> 
      </div> 
      <div id="loading-text">Loading...</div>
    `;
        document.body.appendChild(loadingScreenDiv);

        // UI
        const uiContainerDiv = document.createElement("div");
        uiContainerDiv.id = "ui-container";
        uiContainerDiv.style.display = "none";
        uiContainerDiv.innerHTML = `
      <div class="github-corner">
        <a href="https://github.com/swift502/Sketchbook" target="_blank" title="Fork me on GitHub">
          <svg viewbox="0 0 100 100" fill="currentColor">
            <title>Fork me on GitHub</title>
            <path d="M0 0v100h100V0H0zm60 70.2h.2c1 2.7.3 4.7 0 5.2 1.4 1.4 2 3 2 5.2 0 7.4-4.4 9-8.7 9.5.7.7 1.3 2
            1.3 3.7V99c0 .5 1.4 1 1.4 1H44s1.2-.5 1.2-1v-3.8c-3.5 1.4-5.2-.8-5.2-.8-1.5-2-3-2-3-2-2-.5-.2-1-.2-1
            2-.7 3.5.8 3.5.8 2 1.7 4 1 5 .3.2-1.2.7-2 1.2-2.4-4.3-.4-8.8-2-8.8-9.4 0-2 .7-4 2-5.2-.2-.5-1-2.5.2-5
            0 0 1.5-.6 5.2 1.8 1.5-.4 3.2-.6 4.8-.6 1.6 0 3.3.2 4.8.7 2.8-2 4.4-2 5-2z"></path>
          </svg>
        </a>
      </div>
      <div class="left-panel">
        <div id="controls" class="panel-segment flex-bottom"></div>
      </div>
    `;
        document.body.appendChild(uiContainerDiv);
    }

    private _initializeChatInput(): void {
        document.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                const chatInput = UIManager.getChatInput();
                if (!chatInput) return;

                const chatContainer = document.getElementById("chat-input-container");
                if (chatContainer && chatContainer.classList.contains("expanded")) {
                    // Chat input is visible, send message
                    event.preventDefault();
                    const message = chatInput.value.trim();
                    if (message.length > 0) {
                        this.world.sendMessage(message);
                    }
                    chatInput.value = "";
                    UIManager.setChatInputExpanded(false); // Collapse the chat input
                    this.inputManager.setPointerLock(true); // Re-enable game input
                } else {
                    // Chat input is hidden, show it
                    event.preventDefault();
                    UIManager.setChatInputExpanded(true); // Expand the chat input
                    this.inputManager.setPointerLock(false); // Disable game input
                }
            } else if (event.key === "Escape") {
                const chatContainer = document.getElementById("chat-input-container");
                if (chatContainer && chatContainer.classList.contains("expanded")) {
                    event.preventDefault();
                    UIManager.setChatInputExpanded(false); // Collapse the chat input
                    this.inputManager.setPointerLock(true); // Re-enable game input
                }
            }
        });
    }

    public updateControls(controls: any): void {
        let html = "";
        html += '<h2 class="controls-title">Controls:</h2>';

        controls.forEach((row) => {
            html += '<div class="ctrl-row">';
            row.keys.forEach((key) => {
                if (key === "+" || key === "and" || key === "or" || key === "&")
                    html += "&nbsp;" + key + "&nbsp;";
                else html += '<span class="ctrl-key">' + key + "</span>";
            });

            html += '<span class="ctrl-desc">' + row.desc + "</span></div>";
        });

        document.getElementById("controls").innerHTML = html;
    }

    public setControls(controls: any): void {
        this.updateControls(controls);
    }
}
