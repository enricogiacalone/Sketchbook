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
  ];

  private displayTimer: number = 0;
  private displayDuration: number = 3; // Phrase lasts for 3 seconds
  private defaultCharacterHeight: number = 1.8; // Reference height for scaling

  constructor(characterHeight: number = 1.8) { // Accept characterHeight
    super();

    const scaleFactor = characterHeight / this.defaultCharacterHeight;
    const bubbleWidth = 2 * scaleFactor;
    const bubbleHeight = 0.75 * scaleFactor;
    const bubbleRadius = 0.2 * scaleFactor; // For rounded corners

    // Main Speech bubble mesh (rounded rectangle)
    const roundedRectShape = new THREE.Shape();
    roundedRectShape.moveTo(-bubbleWidth / 2 + bubbleRadius, bubbleHeight / 2);
    roundedRectShape.lineTo(bubbleWidth / 2 - bubbleRadius, bubbleHeight / 2);
    roundedRectShape.quadraticCurveTo(bubbleWidth / 2, bubbleHeight / 2, bubbleWidth / 2, bubbleHeight / 2 - bubbleRadius);
    roundedRectShape.lineTo(bubbleWidth / 2, -bubbleHeight / 2 + bubbleRadius);
    roundedRectShape.quadraticCurveTo(bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth / 2 - bubbleRadius, -bubbleHeight / 2);
    roundedRectShape.lineTo(-bubbleWidth / 2 + bubbleRadius, -bubbleHeight / 2);
    roundedRectShape.quadraticCurveTo(-bubbleWidth / 2, -bubbleHeight / 2, -bubbleWidth / 2, -bubbleHeight / 2 + bubbleRadius);
    roundedRectShape.lineTo(-bubbleWidth / 2, bubbleHeight / 2 - bubbleRadius);
    roundedRectShape.quadraticCurveTo(-bubbleWidth / 2, bubbleHeight / 2, -bubbleWidth / 2 + bubbleRadius, bubbleHeight / 2);

    const bubbleGeometry = new THREE.ShapeGeometry(roundedRectShape);
    const bubbleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
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
    this.textCanvas = document.createElement('canvas');
    this.textContext = this.textCanvas.getContext('2d');
    this.textTexture = new THREE.CanvasTexture(this.textCanvas);
    this.textTexture.minFilter = THREE.LinearFilter; // For better text quality
    this.textMaterial = new THREE.MeshBasicMaterial({ map: this.textTexture, transparent: true });
    
    this.initialTextMeshWidth = (bubbleWidth - 0.2 * scaleFactor); // Store initial width
    this.initialTextMeshHeight = (bubbleHeight - 0.2 * scaleFactor); // Store initial height
    const textGeometry = new THREE.PlaneGeometry(this.initialTextMeshWidth, this.initialTextMeshHeight);
    this.textMesh = new THREE.Mesh(textGeometry, this.textMaterial);
    this.textMesh.position.set(0, characterHeight + 0.9 * scaleFactor, 0.01); // Same position as main bubble, slightly in front
    this.add(this.textMesh);

    this.visible = false;
  }

  private updateTextCanvas(text: string): void {
    const border = 20;
    const font = 'bold 48px Arial'; // Made font bold
    const textColor = '#000000';
    const outlineColor = '#FFFFFF'; // White outline for comic effect
    const outlineWidth = 4;

    // Measure text
    this.textContext.font = font;
    const metrics = this.textContext.measureText(text);
    const textWidth = metrics.width;
    const textHeight = 48; // Approximate height for 48px font

    // Set canvas size (plus space for outline) to a power of 2 for optimal WebGL performance
    this.textCanvas.width = textWidth + border * 2 + outlineWidth * 2;
    this.textCanvas.height = textHeight + border * 2 + outlineWidth * 2;

    // Clear canvas
    this.textContext.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

    // Apply font and styles
    this.textContext.font = font;
    this.textContext.textAlign = 'center';
    this.textContext.textBaseline = 'middle';

    // Draw outline
    this.textContext.strokeStyle = outlineColor;
    this.textContext.lineWidth = outlineWidth * 2; // Twice the width for better visibility
    this.textContext.strokeText(text, this.textCanvas.width / 2, this.textCanvas.height / 2);

    // Draw text
    this.textContext.fillStyle = textColor;
    this.textContext.fillText(text, this.textCanvas.width / 2, this.textCanvas.height / 2);
    
    this.textTexture.needsUpdate = true;

    // Adjust text mesh scale to fit the text content
    const aspectRatio = this.textCanvas.width / this.textCanvas.height;
    
    // Use stored initial dimensions
    const currentTextMeshWidth = this.initialTextMeshWidth;
    const currentTextMeshHeight = this.initialTextMeshHeight;

    const textScaleFactor = Math.min(currentTextMeshWidth / aspectRatio, currentTextMeshHeight) / currentTextMeshHeight;
    this.textMesh.scale.set(aspectRatio * textScaleFactor, textScaleFactor, 1);
  }

  public showRandomPhrase(): void {
    // Only show if not already visible or current display timer has expired
    if (!this.visible || this.displayTimer <= 0) {
        const phrase = this.phrases[Math.floor(Math.random() * this.phrases.length)];
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