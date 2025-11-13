import * as THREE from "three";

export class SpeechBubble extends THREE.Object3D {
  private mesh: THREE.Mesh;
  private tailMesh: THREE.Mesh; // New: for the comic tail
  private textCanvas: HTMLCanvasElement;
  private textContext: CanvasRenderingContext2D;
  private textTexture: THREE.CanvasTexture;
  private textMaterial: THREE.MeshBasicMaterial;
  private textMesh: THREE.Mesh;

  private initialTextMeshWidth: number; // New property
  private initialTextMeshHeight: number; // New property

  private phrases: string[] = [
    "I'm coming for you!",
    "You can't escape!",
    "Gotcha!",
    "Where do you think you're going?",
    "Stop right there!",
    "This is a very long phrase that should definitely wrap around multiple lines to fit inside the speech bubble.",
    "Another example of a phrase that needs to be wrapped.",
    "Short phrase.",
  ];

  private displayTimer: number = 0;
  private displayDuration: number = 5; // Phrase lasts for 5 seconds
  private defaultCharacterHeight: number = 1.8; // Reference height for scaling

  constructor(characterHeight: number = 1.8) {
    // Accept characterHeight
    super();

    const scaleFactor = characterHeight / this.defaultCharacterHeight;
    const bubbleWidth = 2 * scaleFactor;
    const bubbleHeight = 0.75 * scaleFactor;
    const bubbleRadius = 0.2 * scaleFactor; // For rounded corners

    // Main Speech bubble mesh (rounded rectangle)
    const roundedRectShape = new THREE.Shape();
    roundedRectShape.moveTo(-bubbleWidth / 2 + bubbleRadius, bubbleHeight / 2);
    roundedRectShape.lineTo(bubbleWidth / 2 - bubbleRadius, bubbleHeight / 2);
    roundedRectShape.quadraticCurveTo(
      bubbleWidth / 2,
      bubbleHeight / 2,
      bubbleWidth / 2,
      bubbleHeight / 2 - bubbleRadius
    );
    roundedRectShape.lineTo(bubbleWidth / 2, -bubbleHeight / 2 + bubbleRadius);
    roundedRectShape.quadraticCurveTo(
      bubbleWidth / 2,
      -bubbleHeight / 2,
      bubbleWidth / 2 - bubbleRadius,
      -bubbleHeight / 2
    );
    roundedRectShape.lineTo(-bubbleWidth / 2 + bubbleRadius, -bubbleHeight / 2);
    roundedRectShape.quadraticCurveTo(
      -bubbleWidth / 2,
      -bubbleHeight / 2,
      -bubbleWidth / 2,
      -bubbleHeight / 2 + bubbleRadius
    );
    roundedRectShape.lineTo(-bubbleWidth / 2, bubbleHeight / 2 - bubbleRadius);
    roundedRectShape.quadraticCurveTo(
      -bubbleWidth / 2,
      bubbleHeight / 2,
      -bubbleWidth / 2 + bubbleRadius,
      bubbleHeight / 2
    );

    const bubbleGeometry = new THREE.ShapeGeometry(roundedRectShape);
    const bubbleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
    this.mesh.position.set(0, characterHeight + 0.9 * scaleFactor, 0); // Position above the character's head
    this.mesh.renderOrder = 999; // Ensure it renders on top
    this.add(this.mesh);

    // Speech bubble tail mesh (simple triangle)
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(0.2 * scaleFactor, 0.2 * scaleFactor);
    tailShape.lineTo(-0.2 * scaleFactor, 0.2 * scaleFactor);
    tailShape.lineTo(0, 0);
    const tailGeometry = new THREE.ShapeGeometry(tailShape);
    this.tailMesh = new THREE.Mesh(tailGeometry, bubbleMaterial);
    this.tailMesh.position.set(0, characterHeight + 0.5 * scaleFactor, 0.01); // Positioned below main bubble, slightly in front
    this.tailMesh.renderOrder = 999; // Ensure it renders on top
    this.add(this.tailMesh);

    // Text canvas and texture
    this.textCanvas = document.createElement("canvas");
    this.textContext = this.textCanvas.getContext("2d");
    this.textTexture = new THREE.CanvasTexture(this.textCanvas);
    this.textTexture.minFilter = THREE.LinearFilter; // For better text quality
    this.textMaterial = new THREE.MeshBasicMaterial({
      map: this.textTexture,
      transparent: true,
      depthTest: false, // Disable depth testing
      depthWrite: false, // Disable depth writing
    });

    this.initialTextMeshWidth = bubbleWidth - 0.2 * scaleFactor; // Store initial width
    this.initialTextMeshHeight = bubbleHeight - 0.2 * scaleFactor; // Store initial height
    const textGeometry = new THREE.PlaneGeometry(
      this.initialTextMeshWidth,
      this.initialTextMeshHeight
    );
    this.textMesh = new THREE.Mesh(textGeometry, this.textMaterial);
    this.textMesh.position.set(0, characterHeight + 0.9 * scaleFactor, 0.02); // Slightly in front of the bubble
    this.textMesh.renderOrder = 1000; // Ensure text renders on top of the bubble
    this.add(this.textMesh);

    this.visible = false;
  }

  private wrapText(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + " " + word;
      const metrics = context.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    return lines;
  }

  private updateTextCanvas(text: string): void {
    const canvasWidth = 512;
    const canvasHeight = 256;
    this.textCanvas.width = canvasWidth;
    this.textCanvas.height = canvasHeight;

    const border = 20;
    const outlineColor = "#FFFFFF";
    const outlineWidth = 4;
    const textColor = "#000000";

    this.textContext.clearRect(0, 0, canvasWidth, canvasHeight);

    let fontSize = 48;
    let lines: string[] = [];
    let textHeightPx = 0;
    const lineHeightMultiplier = 1.2;
    const maxTextWidthPx = canvasWidth - (border * 2 + outlineWidth * 2);
    const maxTextHeightPx = canvasHeight - (border * 2 + outlineWidth * 2);

    // Iteratively reduce font size until text fits both width and height
    while (fontSize > 10) {
      this.textContext.font = `bold ${fontSize}px Arial`;
      lines = this.wrapText(this.textContext, text, maxTextWidthPx);
      textHeightPx = lines.length * fontSize * lineHeightMultiplier;

      if (textHeightPx <= maxTextHeightPx) {
        break;
      }
      fontSize -= 2;
    }

    this.textContext.font = `bold ${fontSize}px Arial`;
    this.textContext.textAlign = "center";
    this.textContext.textBaseline = "middle";

    const startY =
      (canvasHeight - textHeightPx) / 2 + (fontSize * lineHeightMultiplier) / 2;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = startY + i * fontSize * lineHeightMultiplier;

      this.textContext.strokeStyle = outlineColor;
      this.textContext.lineWidth = outlineWidth * 2;
      this.textContext.strokeText(line, canvasWidth / 2, lineY);

      this.textContext.fillStyle = textColor;
      this.textContext.fillText(line, canvasWidth / 2, lineY);
    }

    this.textTexture.needsUpdate = true;

    // The textMesh should already be scaled to fit the bubble's dimensions in the constructor.
    // No dynamic scaling here.
  }

  public show(message: string): void {
    this.updateTextCanvas(message);
    this.visible = true;
    this.displayTimer = this.displayDuration;
  }

  public showRandomPhrase(): void {
    // Only show if not already visible or current display timer has expired
    if (!this.visible || this.displayTimer <= 0) {
      const phrase =
        this.phrases[Math.floor(Math.random() * this.phrases.length)];
      this.show(phrase);
    }
  }

  public hide(): void {
    this.visible = false;
    this.displayTimer = 0; // Reset timer when hidden
  }

  public update(timeStep: number): void {
    if (this.visible) {
      this.displayTimer -= timeStep;
      if (this.displayTimer <= 0) {
        this.hide();
      }
    }
  }

  public dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.remove(this.mesh);
      this.mesh = undefined;
    }
    if (this.tailMesh) {
      this.tailMesh.geometry.dispose();
      (this.tailMesh.material as THREE.Material).dispose();
      this.remove(this.tailMesh);
      this.tailMesh = undefined;
    }
    if (this.textMesh) {
      this.textMesh.geometry.dispose();
      (this.textMesh.material as THREE.Material).dispose();
      this.remove(this.textMesh);
      this.textMesh = undefined;
    }
    if (this.textTexture) {
      this.textTexture.dispose();
      this.textTexture = undefined;
    }
    if (this.textCanvas) {
      // No explicit dispose for canvas, but clearing reference helps GC
      this.textContext = undefined;
      this.textCanvas = undefined;
    }
  }
}
