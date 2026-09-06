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
  // Which of the vehicle's doors (by glb node name, e.g. "door_3") is the
  // one actually being walked through for the current transition -- set
  // alongside transitioningEntityId so a car with more than one usable
  // entrance (see Player.tsx's getVehicleEntrances) knows WHICH of its
  // doors to swing open, instead of always animating the driver's.
  transitioningDoorName: string | null;
  // True while the game is paused (Start/Escape, or automatically when the
  // browser tab is backgrounded -- see App.tsx's visibilitychange listener).
  // Drives <Physics paused> in App.tsx plus explicit early-returns in
  // Player.tsx/Car.tsx/Airplane.tsx/Helicopter.tsx's per-frame logic, since
  // Physics pausing only stops the physics WORLD stepping (so
  // useBeforePhysicsStep callbacks don't fire) -- it doesn't stop plain
  // useFrame callbacks elsewhere, and direct RigidBody setters like
  // setTranslation/setLinvel take effect immediately regardless of whether
  // the world is stepping, so anything still calling those every frame
  // would keep moving things even while "paused".
  isPaused: boolean;
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
  setIsVehicleTransitioning: (transitioning: boolean, entityId?: string | null, doorName?: string | null) => void;
  togglePause: () => void;
  setPaused: (paused: boolean) => void;
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
  transitioningDoorName: null,
  isPaused: false,
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
  setIsVehicleTransitioning: (transitioning, entityId = null, doorName = null) => set({
    isVehicleTransitioning: transitioning,
    transitioningEntityId: transitioning ? entityId : null,
    transitioningDoorName: transitioning ? doorName : null,
  }),
  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
  // Separate from togglePause: the tab-hidden auto-pause always wants to
  // force pause ON, never flip an already-paused game back to running.
  setPaused: (paused) => set({ isPaused: paused }),
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

// TEMP DEBUG (Claude): expose store for live console inspection while
// diagnosing the vehicle-visibility bug. Safe no-op in production builds.
if (import.meta.env.DEV) {
  (window as any).__gameStore = useStore;
}
