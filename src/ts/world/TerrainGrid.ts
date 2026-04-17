import * as THREE from "three";

export enum TerrainCellType {
  Empty,
  Road,
  Building,
  Tree,
  Grass, // New: Grass type
  // Add other types as needed
}

export class TerrainGrid {
  private grid: TerrainCellType[][];
  private resolution: number; // Units per cell
  private halfSize: number; // Half of the terrainSize

  constructor(terrainSize: number, resolution: number) {
    this.resolution = resolution;
    this.halfSize = terrainSize / 2;
    const gridSize = Math.ceil(terrainSize / resolution);
    this.grid = Array(gridSize)
      .fill(null)
      .map(() => Array(gridSize).fill(TerrainCellType.Empty));
  }

  private getGridCoordinates(
    x: number,
    z: number
  ): { gx: number; gz: number } | null {
    const gx = Math.floor((x + this.halfSize) / this.resolution);
    const gz = Math.floor((z + this.halfSize) / this.resolution);

    if (
      gx >= 0 &&
      gx < this.grid.length &&
      gz >= 0 &&
      gz < this.grid[0].length
    ) {
      return { gx, gz };
    }
    return null;
  }

  public mark(x: number, z: number, type: TerrainCellType): void {
    const coords = this.getGridCoordinates(x, z);
    if (coords) {
      this.grid[coords.gx][coords.gz] = type;
    }
  }

  public isOccupied(
    x: number,
    z: number,
    checkType?: TerrainCellType
  ): boolean {
    const coords = this.getGridCoordinates(x, z);
    if (coords) {
      const cellType = this.grid[coords.gx][coords.gz];
      if (checkType !== undefined) {
        return cellType === checkType;
      }
      return cellType !== TerrainCellType.Empty;
    }
    return false; // Outside grid, consider as not occupied by our features
  }

  // You might want methods to mark areas (e.g., a road segment)
  public markArea(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    type: TerrainCellType
  ): void {
    const startCoords = this.getGridCoordinates(
      Math.min(x1, x2),
      Math.min(z1, z2)
    );
    const endCoords = this.getGridCoordinates(
      Math.max(x1, x2),
      Math.max(z1, z2)
    );

    if (!startCoords || !endCoords) return;

    for (let gx = startCoords.gx; gx <= endCoords.gx; gx++) {
      for (let gz = startCoords.gz; gz <= endCoords.gz; gz++) {
        // Convert grid coords back to world coords for more precise checks if needed
        // For a simple grid, this is enough
        if (
          gx >= 0 &&
          gx < this.grid.length &&
          gz >= 0 &&
          gz < this.grid[0].length
        ) {
          this.grid[gx][gz] = type;
        }
      }
    }
  }
}
