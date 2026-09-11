import * as THREE from "three";

export class Stylizer {
  private static toonMaterial: THREE.MeshToonMaterial;

  public static initializeToonMaterial(): void {
    if (!Stylizer.toonMaterial) {
      const gradientMap = new THREE.DataTexture(
        new Uint8Array([0, 0, 0, 255, 128, 128, 128, 255]), // Black, Gray
        2,
        1,
        THREE.RGBAFormat
      );
      gradientMap.needsUpdate = true;
      Stylizer.toonMaterial = new THREE.MeshToonMaterial({
        gradientMap: gradientMap,
      });
    }
  }

  public static applyToonStyle(mesh: THREE.Mesh): void {
    if (!Stylizer.toonMaterial) {
      Stylizer.initializeToonMaterial();
    }

    // Apply Toon Material
    const toonMaterial = Stylizer.toonMaterial.clone();
    if (
      mesh.material instanceof THREE.MeshStandardMaterial ||
      mesh.material instanceof THREE.MeshLambertMaterial
    ) {
      toonMaterial.color.copy(mesh.material.color);
      if (mesh.material.map) {
        toonMaterial.map = mesh.material.map;
      }
    } else if (Array.isArray(mesh.material)) {
      // Handle multiple materials (e.g., for GLTF models with multiple parts)
      mesh.material = mesh.material.map((mat) => {
        const newToonMat = Stylizer.toonMaterial.clone();
        if (mat.color) newToonMat.color.copy(mat.color);
        if (mat.map) newToonMat.map = mat.map;
        return newToonMat;
      });
      return; // Skip outline for now for multiple materials as it's more complex
    } else {
      // Default case for other material types or if color/map not found
      toonMaterial.color.set(0xcccccc); // A default color
    }
    mesh.material = toonMaterial;

    // Create and add outline mesh ONLY if child has a parent
    if (mesh.parent) {
      const outlineMesh = mesh.clone();
      const outlineMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.BackSide,
      });
      outlineMesh.material = outlineMaterial;
      outlineMesh.scale.multiplyScalar(1.02); // Slightly larger
      mesh.parent.add(outlineMesh);
    }
  }
}
