import { World } from "../world/World";
import { IUpdatable } from "../interfaces/IUpdatable";
import { Character } from "../characters/Character";
import { EntityType } from "../enums/EntityType";
import * as THREE from "three";
import { Vehicle } from "../vehicles/Vehicle";

export class Minimap implements IUpdatable {
  public updateOrder: number = 10;

  private world: World;
  private container: HTMLElement;
  private playerDot: HTMLElement;
  private northIndicator: HTMLElement;
  private healthBar: HTMLElement;
  private armorBar: HTMLElement;
  private enemyDots: HTMLElement[] = [];
  private vehicleIcons: HTMLElement[] = [];
  private mapSize: number = 200; // Same as CSS
  private worldSize: number = 100; // The size of the world area to display on the map
  private defaultWorldSize: number = 100;
  private zoomedWorldSize: number = 200;

  constructor(world: World) {
    this.world = world;
    this.container = document.getElementById("minimap-container");
    this.playerDot = document.getElementById("minimap-player");
    this.northIndicator = document.getElementById("minimap-north");
    this.healthBar = document.querySelector("#health-bar .bar-arc-fill");
    this.armorBar = document.querySelector("#armor-bar .bar-arc-fill");

    this.world.registerUpdatable(this);
  }

  public update(timestep: number): void {
    const player = this.world.characters[0];
    if (!player) return;

    // Rotate minimap container inversely to player's yaw
    const playerForward = player.orientation.clone().setY(0).normalize();
    const playerYaw = Math.atan2(playerForward.x, playerForward.z);
    this.container.style.transform = `rotate(${-playerYaw}rad)`;

    // North indicator moves to the edge of the circle
    // The angle of world north relative to the minimap's "up" (player's forward)
    const northAngleOnMinimap = playerYaw; // This is the angle from minimap's "up" to world north

    const radius = this.mapSize / 2 - 10; // Position inside the border
    const northX = this.mapSize / 2 + radius * Math.sin(northAngleOnMinimap);
    const northY = this.mapSize / 2 - radius * Math.cos(northAngleOnMinimap);
    this.northIndicator.style.left = `${northX}px`;
    this.northIndicator.style.top = `${northY}px`;
    this.northIndicator.style.transform = `translate(-50%, -50%) rotate(${playerYaw}rad)`; // Counter-rotate to keep pointing north

    // Player dot is always in the center and pointing up (no rotation)
    this.playerDot.style.left = `${this.mapSize / 2}px`;
    this.playerDot.style.top = `${this.mapSize / 2}px`;
    this.playerDot.style.transform = `translate(-50%, -50%) rotate(${playerYaw}rad)`; // Counter-rotate to keep pointing up

    // Zoom based on player speed
    const speed = player.velocity.length();
    if (speed > 10) {
      this.worldSize = THREE.MathUtils.lerp(
        this.worldSize,
        this.zoomedWorldSize,
        0.1
      );
    } else {
      this.worldSize = THREE.MathUtils.lerp(
        this.worldSize,
        this.defaultWorldSize,
        0.1
      );
    }

    // Update health and armor bars
    this.updateHealthArmor(player);

    // Update enemy dots
    const enemies = this.world.characters.filter(
      (c) => c.entityType === EntityType.Enemy
    );
    this.updateIcons(
      enemies,
      this.enemyDots,
      "minimap-enemy",
      player,
      this.updateEnemyDot,
      playerYaw
    );

    // Update vehicle icons
    this.updateIcons(
      this.world.vehicles,
      this.vehicleIcons,
      "minimap-vehicle",
      player,
      this.updateVehicleIcon,
      playerYaw
    );
  }

  private updateIcons<T extends Character | Vehicle>(
    items: T[],
    icons: HTMLElement[],
    className: string,
    player: Character,
    updateMethod: (
      icon: HTMLElement,
      item: T,
      player: Character,
      playerYaw: number
    ) => void,
    playerYaw: number
  ): void {
    // Remove old icons
    while (icons.length > items.length) {
      const icon = icons.pop();
      icon.remove();
    }

    // Add new icons if needed
    while (icons.length < items.length) {
      const icon = document.createElement("div");
      icon.className = className;
      this.container.appendChild(icon);
      icons.push(icon);
    }

    // Update positions of icons
    for (let i = 0; i < items.length; i++) {
      updateMethod.call(this, icons[i], items[i], player, playerYaw);
    }
  }

  private updateHealthArmor(player: Character): void {
    const healthPercentage = player.health / player.maxHealth;
    const armorPercentage = 0; // Assuming no armor for now

    if (this.healthBar) {
      this.healthBar.style.transform = `rotate(${45 + 180 * healthPercentage}deg)`;
    }
    if (this.armorBar) {
      this.armorBar.style.transform = `rotate(${225 + 180 * armorPercentage}deg)`;
    }
  }

  private updateEnemyDot(
    dot: HTMLElement,
    enemy: Character,
    player: Character,
    playerYaw: number
  ): void {
    const relativeX = enemy.position.x - player.position.x;
    const relativeZ = enemy.position.z - player.position.z;

    const mapX = (relativeX / this.worldSize) * this.mapSize + this.mapSize / 2;
    const mapY = (relativeZ / this.worldSize) * this.mapSize + this.mapSize / 2;

    dot.style.left = `${mapX}px`;
    dot.style.top = `${mapY}px`;
  }

  private updateVehicleIcon(
    icon: HTMLElement,
    vehicle: Vehicle,
    player: Character,
    playerYaw: number
  ): void {
    // Set correct class for vehicle type
    const vehicleType = vehicle.entityType;
    let typeClass = "";
    if (vehicleType === EntityType.Car) typeClass = "minimap-car";
    else if (vehicleType === EntityType.Airplane)
      typeClass = "minimap-airplane";
    else if (vehicleType === EntityType.Helicopter)
      typeClass = "minimap-helicopter";
    icon.className = `minimap-vehicle ${typeClass}`;

    // Position
    const relativeX = vehicle.position.x - player.position.x;
    const relativeZ = vehicle.position.z - player.position.z;
    const mapX = (relativeX / this.worldSize) * this.mapSize + this.mapSize / 2;
    const mapY = (relativeZ / this.worldSize) * this.mapSize + this.mapSize / 2;
    icon.style.left = `${mapX}px`;
    icon.style.top = `${mapY}px`;

    // Rotation
    if (vehicle.quaternion) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        vehicle.quaternion
      );
      const yaw = Math.atan2(forward.x, forward.z);
      const vehicleAngle = (yaw - playerYaw) * (180 / Math.PI); // Adjust for minimap rotation
      icon.style.transform = `translate(-50%, -50%) rotate(${vehicleAngle}deg)`;
    }
  }
}
