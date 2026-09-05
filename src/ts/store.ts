import { create } from 'zustand';

export type ControllableType = 'player' | 'car' | 'airplane' | 'helicopter';

export interface EntityInfo {
  id: string;
  type: 'player' | 'enemy' | 'car' | 'airplane' | 'helicopter' | 'ufo';
  position: [number, number, number];
  rotation: number; // Yaw in radians
}

interface GameState {
  health: number;
  maxHealth: number;
  armor: number;
  currentControllable: ControllableType;
  controlledEntityId: string | null;
  // True while the player is mid walk-in/walk-out of a vehicle (see
  // Player.tsx's vehicleTransition). Vehicles ignore driving input while
  // this is true, so you can't still steer a car away while visibly
  // climbing out of it.
  isVehicleTransitioning: boolean;
  // The vehicle currently being entered or exited, set for the whole
  // transition (both entering and exiting). Needed separately from
  // controlledEntityId because that only updates once the transition
  // finishes -- a vehicle mid-entry needs to know *now* that it's the one
  // whose door should swing open, not once the character has already sat
  // down.
  transitioningEntityId: string | null;
  isLoading: boolean;
  isCrosshairVisible: boolean;
  playerPos: [number, number, number];
  playerYaw: number;
  playerMessage: string;
  entities: Map<string, EntityInfo>;
  setHealth: (health: number) => void;
  setMaxHealth: (maxHealth: number) => void;
  setArmor: (armor: number) => void;
  setCurrentControllable: (type: ControllableType, id?: string | null) => void;
  setIsVehicleTransitioning: (transitioning: boolean, entityId?: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsCrosshairVisible: (visible: boolean) => void;
  setPlayerInfo: (pos: [number, number, number], yaw: number) => void;
  setPlayerMessage: (message: string) => void;
  updateEntity: (id: string, info: Partial<EntityInfo>) => void;
  removeEntity: (id: string) => void;
}

export const useStore = create<GameState>((set) => ({
  health: 100,
  maxHealth: 100,
  armor: 0,
  currentControllable: 'player',
  controlledEntityId: null,
  isVehicleTransitioning: false,
  transitioningEntityId: null,
  isLoading: false, // Set to false initially to show WelcomeScreen
  isCrosshairVisible: false,
  playerPos: [0, 0, 0],
  playerYaw: 0,
  playerMessage: '',
  entities: new Map(),
  setHealth: (health) => set({ health }),
  setMaxHealth: (maxHealth) => set({ maxHealth }),
  setArmor: (armor) => set({ armor }),
  setCurrentControllable: (type, id = null) => set({ currentControllable: type, controlledEntityId: id }),
  setIsVehicleTransitioning: (transitioning, entityId = null) => set({ isVehicleTransitioning: transitioning, transitioningEntityId: transitioning ? entityId : null }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsCrosshairVisible: (visible) => set({ isCrosshairVisible: visible }),
  setPlayerInfo: (pos, yaw) => set({ playerPos: pos, playerYaw: yaw }),
  setPlayerMessage: (message) => set({ playerMessage: message }),
  updateEntity: (id, info) => set((state) => {
    const newEntities = new Map(state.entities);
    const existing = newEntities.get(id) || { id, type: 'enemy', position: [0,0,0], rotation: 0 };
    newEntities.set(id, { ...existing, ...info } as EntityInfo);
    return { entities: newEntities };
  }),
  removeEntity: (id) => set((state) => {
    const newEntities = new Map(state.entities);
    newEntities.delete(id);
    return { entities: newEntities };
  }),
}));
