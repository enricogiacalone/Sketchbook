import { create } from 'zustand';

export type ControllableType = 'player' | 'car' | 'airplane' | 'helicopter';
// Which kind of seat the player currently occupies inside a vehicle -- null
// whenever currentControllable is 'player'. Mirrors the legacy SeatType
// enum (driver/passenger), read straight off each seat's own
// userData.seat_type (see Player.tsx's getSeatInfo()). Driver-seat occupancy
// is what actually lets a vehicle read driving input (see Car.tsx/
// Helicopter.tsx's isActive checks) -- sitting in a passenger seat just
// rides along.
export type SeatKind = 'driver' | 'passenger' | null;

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
  // Which seat (by glb node name, e.g. "seat_2") and kind (driver/passenger)
  // the player occupies while parked in a vehicle. Both null whenever
  // currentControllable is 'player'. See setCurrentControllable.
  controlledSeatType: SeatKind;
  controlledSeatName: string | null;
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
  // Doors left open independent of isVehicleTransitioning, keyed by
  // "<vehicleId>:<doorName>". A door is added here the moment it's walked
  // through (entering or exiting) and only removed once the character's own
  // close-door animation finishes (see Player.tsx's doorCloseTransition /
  // closingDoorOutside refs -- the ports of the legacy
  // CloseVehicleDoorInside/Outside character states), NOT simply when the
  // entering/exiting transition itself ends. That's what lets a car sit
  // there with its door hanging open while you're stopped mid-drive, exactly
  // like the original.
  openVehicleDoors: Record<string, boolean>;
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
  // "aggiungi oggetti da collezionare per tutta la citta" -- total is
  // set once by Collectibles.tsx on mount (it owns the actual list/
  // positions), found increments as the player walks over one. Kept as
  // plain counts (not the collected-id set itself, which stays local to
  // Collectibles.tsx) so the HUD can subscribe to two numbers instead of
  // re-rendering every time any single item's visibility changes.
  collectiblesFound: number;
  collectiblesTotal: number;
  entities: Map<string, EntityInfo>;
  setHealth: (health: number) => void;
  setMaxHealth: (maxHealth: number) => void;
  setArmor: (armor: number) => void;
  setCurrentControllable: (type: ControllableType, id?: string | null, seatType?: SeatKind, seatName?: string | null) => void;
  setIsVehicleTransitioning: (transitioning: boolean, entityId?: string | null, doorName?: string | null) => void;
  setDoorOpen: (vehicleId: string, doorName: string, open: boolean) => void;
  togglePause: () => void;
  setPaused: (paused: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsCrosshairVisible: (visible: boolean) => void;
  setPlayerInfo: (pos: [number, number, number], yaw: number) => void;
  setPlayerMessage: (message: string) => void;
  setCollectiblesTotal: (total: number) => void;
  collectItem: () => void;
  updateEntity: (id: string, info: Partial<EntityInfo>) => void;
  removeEntity: (id: string) => void;
}

export const useStore = create<GameState>((set) => ({
  health: 100,
  maxHealth: 100,
  armor: 0,
  currentControllable: 'player',
  controlledEntityId: null,
  controlledSeatType: null,
  controlledSeatName: null,
  isVehicleTransitioning: false,
  transitioningEntityId: null,
  transitioningDoorName: null,
  openVehicleDoors: {},
  isPaused: false,
  isLoading: false, // Set to false initially to show WelcomeScreen
  isCrosshairVisible: false,
  playerPos: [0, 0, 0],
  playerYaw: 0,
  playerMessage: '',
  collectiblesFound: 0,
  collectiblesTotal: 0,
  entities: new Map(),
  setHealth: (health) => set({ health }),
  setMaxHealth: (maxHealth) => set({ maxHealth }),
  setArmor: (armor) => set({ armor }),
  setCurrentControllable: (type, id = null, seatType = null, seatName = null) => set({
    currentControllable: type,
    controlledEntityId: id,
    controlledSeatType: type === 'player' ? null : seatType,
    controlledSeatName: type === 'player' ? null : seatName,
  }),
  setIsVehicleTransitioning: (transitioning, entityId = null, doorName = null) => set({
    isVehicleTransitioning: transitioning,
    transitioningEntityId: transitioning ? entityId : null,
    transitioningDoorName: transitioning ? doorName : null,
  }),
  setDoorOpen: (vehicleId, doorName, open) => set((state) => {
    const key = `${vehicleId}:${doorName}`;
    const isOpen = !!state.openVehicleDoors[key];
    if (isOpen === open) return state;
    const next = { ...state.openVehicleDoors };
    if (open) next[key] = true;
    else delete next[key];
    return { openVehicleDoors: next };
  }),
  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
  // Separate from togglePause: the tab-hidden auto-pause always wants to
  // force pause ON, never flip an already-paused game back to running.
  setPaused: (paused) => set({ isPaused: paused }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsCrosshairVisible: (visible) => set({ isCrosshairVisible: visible }),
  setPlayerInfo: (pos, yaw) => set({ playerPos: pos, playerYaw: yaw }),
  setPlayerMessage: (message) => set({ playerMessage: message }),
  setCollectiblesTotal: (total) => set({ collectiblesTotal: total }),
  collectItem: () => set((state) => ({ collectiblesFound: Math.min(state.collectiblesTotal, state.collectiblesFound + 1) })),
  // "serve ottimizzare ancora" -- every car/pedestrian/enemy calls this on
  // a fixed timer (Car.tsx ~10/s, Pedestrian.tsx ~5/s) regardless of
  // whether it actually moved since the last call. A stationary parked car
  // (of which a full city has ~30) was rebroadcasting an UNCHANGED
  // position 10 times a second forever, and every single call cloned the
  // ENTIRE entities Map (every car/pedestrian/enemy in the city) just to
  // put back the same values -- pure allocation + zustand-notify churn for
  // no actual change. Bail out (return the SAME state object, which
  // zustand's own Object.is check treats as "nothing to do" and skips
  // notifying subscribers entirely -- Minimap.tsx included) whenever the
  // incoming position/rotation/type match what's already stored, within a
  // small epsilon so ordinary physics/floating-point jitter on a
  // "resting" body doesn't defeat this.
  updateEntity: (id, info) => set((state) => {
    const existing = state.entities.get(id);
    if (existing) {
      const posSame =
        !info.position ||
        (Math.abs(info.position[0] - existing.position[0]) < 0.01 &&
          Math.abs(info.position[1] - existing.position[1]) < 0.01 &&
          Math.abs(info.position[2] - existing.position[2]) < 0.01);
      const rotSame = info.rotation === undefined || Math.abs(info.rotation - existing.rotation) < 0.01;
      const typeSame = info.type === undefined || info.type === existing.type;
      if (posSame && rotSame && typeSame) return state;
    }
    const newEntities = new Map(state.entities);
    const base = existing || { id, type: 'enemy', position: [0, 0, 0], rotation: 0 };
    newEntities.set(id, { ...base, ...info } as EntityInfo);
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
