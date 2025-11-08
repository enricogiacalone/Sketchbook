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
  private displayDuration: number = 3; // Phrase lasts for 3 seconds
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
    this.add(this.tailMesh);

    // Text canvas and texture
    this.textCanvas = document.createElement("canvas");
    this.textContext = this.textCanvas.getContext("2d");
    this.textTexture = new THREE.CanvasTexture(this.textCanvas);
    this.textTexture.minFilter = THREE.LinearFilter; // For better text quality
    this.textMaterial = new THREE.MeshBasicMaterial({
      map: this.textTexture,
      transparent: true,
    });

    this.initialTextMeshWidth = bubbleWidth - 0.2 * scaleFactor; // Store initial width
    this.initialTextMeshHeight = bubbleHeight - 0.2 * scaleFactor; // Store initial height
    const textGeometry = new THREE.PlaneGeometry(
      this.initialTextMeshWidth,
      this.initialTextMeshHeight
    );
    this.textMesh = new THREE.Mesh(textGeometry, this.textMaterial);
    this.textMesh.position.set(0, characterHeight + 0.9 * scaleFactor, 0.01); // Same position as main bubble, slightly in front
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
    const border = 20;
    const outlineColor = "#FFFFFF"; // White outline for comic effect
    const outlineWidth = 4;
    const textColor = "#000000";

    // Calculate maximum allowed text dimensions based on the bubble's dimensions
    // We use a ratio to convert from THREE.PlaneGeometry dimensions to canvas pixels
    const pixelsPerUnit = 256; // A reasonable arbitrary value for converting world units to pixels
    const maxTextWidthPx =
      this.initialTextMeshWidth * pixelsPerUnit -
      (border * 2 + outlineWidth * 2);
    const maxTextHeightPx =
      this.initialTextMeshHeight * pixelsPerUnit -
      (border * 2 + outlineWidth * 2);

    let fontSize = 48; // Start with a reasonable font size
    let lines: string[] = [];
    let textHeightPx = 0;
    let widestLinePx = 0;
    const lineHeightMultiplier = 1.2; // 120% of font size for line height

    // Iteratively reduce font size until text fits both width and height
    while (fontSize > 10) {
      // Minimum font size of 10px
      this.textContext.font = `bold ${fontSize}px Arial`;
      lines = this.wrapText(this.textContext, text, maxTextWidthPx);

      widestLinePx = 0;
      for (const line of lines) {
        const metrics = this.textContext.measureText(line);
        if (metrics.width > widestLinePx) {
          widestLinePx = metrics.width;
        }
      }
      textHeightPx = lines.length * fontSize * lineHeightMultiplier;

      if (widestLinePx <= maxTextWidthPx && textHeightPx <= maxTextHeightPx) {
        break; // Text fits, break the loop
      }
      fontSize -= 2; // Reduce font size and try again
    }

    // If text still doesn't fit after reducing font size to minimum, it will be clipped.
    // This is a fallback, ideally, phrases should be designed to fit.

    // Set canvas size
    // Add padding for border and outline
    this.textCanvas.width = Math.min(
      2048,
      widestLinePx + border * 2 + outlineWidth * 2
    );
    this.textCanvas.height = Math.min(
      2048,
      textHeightPx + border * 2 + outlineWidth * 2
    );

    // Clear canvas
    this.textContext.clearRect(
      0,
      0,
      this.textCanvas.width,
      this.textCanvas.height
    );

    // Apply font and styles
    this.textContext.font = `bold ${fontSize}px Arial`;
    this.textContext.textAlign = "center";
    this.textContext.textBaseline = "middle";

    const startY =
      (this.textCanvas.height - textHeightPx) / 2 +
      (fontSize * lineHeightMultiplier) / 2;

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = startY + i * fontSize * lineHeightMultiplier;

      // Draw outline
      this.textContext.strokeStyle = outlineColor;
      this.textContext.lineWidth = outlineWidth * 2;
      this.textContext.strokeText(line, this.textCanvas.width / 2, lineY);

      // Draw text
      this.textContext.fillStyle = textColor;
      this.textContext.fillText(line, this.textCanvas.width / 2, lineY);
    }

    this.textTexture.needsUpdate = true;

    // Adjust text mesh scale to fit the text content
    const aspectRatio = this.textCanvas.width / this.textCanvas.height;

    // Use stored initial dimensions
    const currentTextMeshWidth = this.initialTextMeshWidth;
    const currentTextMeshHeight = this.initialTextMeshHeight;

    // Scale the text mesh to fit the canvas content, maintaining aspect ratio
    // The goal is to make the text mesh match the canvas content's aspect ratio
    // and fit within the initialTextMeshWidth/Height constraints.
    let meshWidth = currentTextMeshWidth;
    let meshHeight = currentTextMeshHeight;

    const canvasAspectRatio = this.textCanvas.width / this.textCanvas.height;
    const meshAspectRatio = currentTextMeshWidth / currentTextMeshHeight;

    if (canvasAspectRatio > meshAspectRatio) {
      // Canvas is wider than mesh area, constrain by width
      meshHeight = currentTextMeshWidth / canvasAspectRatio;
    } else {
      // Canvas is taller than mesh area, constrain by height
      meshWidth = currentTextMeshHeight * canvasAspectRatio;
    }

    this.textMesh.scale.set(
      meshWidth / this.textMesh.geometry.parameters.width,
      meshHeight / this.textMesh.geometry.parameters.height,
      1
    );
  }

  public showRandomPhrase(): void {
    // Only show if not already visible or current display timer has expired
    if (!this.visible || this.displayTimer <= 0) {
      const phrase =
        this.phrases[Math.floor(Math.random() * this.phrases.length)];
      this.updateTextCanvas(phrase);
      this.visible = true;
      this.displayTimer = this.displayDuration;
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
}
