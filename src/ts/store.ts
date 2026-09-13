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

// "crea una missione come in gta" -- a short chain of GTA-style
// objectives (drive somewhere / eliminate a target / survive a wave).
// MissionManager.tsx owns the actual per-frame state machine (timers,
// spawning, success/fail checks); this is just the mirror of it that the
// HUD, the minimap blip, and the in-world marker meshes all read.
export type MissionStatus = 'inactive' | 'active' | 'success' | 'failed' | 'allComplete';

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
  // Mirrors Player.tsx's own isGrounded ref (recomputed every frame from
  // distToGround + fall speed there) so OTHER systems that need to know
  // "is the player actually standing, not mid-fall/mid-jump" -- currently
  // just Collectibles.tsx, which must not count a pickup while the player
  // is still falling through a collectible's height on the way down --
  // don't need their own copy of that ground-snap math. Written every
  // frame from Player.tsx but only actually changes (and notifies
  // subscribers) on takeoff/landing -- see setIsPlayerGrounded's own bail-
  // out, same pattern as updateEntity's.
  isPlayerGrounded: boolean;
  // TEMP DEBUG (Claude): which clean, distraction-free test scenario is
  // active -- 'none' is the normal game world. Scene.tsx reads this to
  // strip the city/traffic/collectibles/missions out and leave just the
  // ground + airport pads + the two flyable vehicles, so testing flight
  // physics isn't confounded by unrelated systems (other cars, enemies,
  // meteorites...). Set via window.__sim.startTest()/endTest() (see
  // debug/simDebug.ts) or the "Scenari" lil-gui panel (ScenariosGUI.tsx).
  testScene: 'none' | 'airplane' | 'helicopter' | 'car' | 'race';
  entities: Map<string, EntityInfo>;
  setHealth: (health: number) => void;
  setMaxHealth: (maxHealth: number) => void;
  setArmor: (armor: number) => void;
  // Functional (reads state.health itself) rather than Player.tsx computing
  // "prev - amount" from its own destructured `health` snapshot and calling
  // setHealth with the result -- two bullet hits landing in the same
  // render tick would otherwise both subtract from the same stale prev
  // value (classic lost-update), same reason Enemy.tsx's local
  // setHealth(prev => ...) uses the updater form.
  takeDamage: (amount: number) => void;
  // Index into MissionManager.tsx's MISSIONS array -- which objective is
  // current/next. Stays the same across a 'failed' status (retry the same
  // stage) and only advances after a 'success'.
  missionStage: number;
  missionStatus: MissionStatus;
  missionTitle: string;
  missionBriefing: string;
  missionTimeRemaining: number;
  // World-space [x, z] of the current objective (drive destination or
  // elimination target) -- null when the active mission has no fixed
  // point (the survive-a-wave stage) or when no mission is active.
  missionTargetPos: [number, number] | null;
  setMissionStage: (stage: number) => void;
  setMissionStatus: (status: MissionStatus) => void;
  setMissionInfo: (title: string, briefing: string) => void;
  setMissionTimeRemaining: (t: number) => void;
  setMissionTargetPos: (pos: [number, number] | null) => void;
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
  setIsPlayerGrounded: (grounded: boolean) => void;
  setTestScene: (scene: 'none' | 'airplane' | 'helicopter' | 'car' | 'race') => void;
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
  // Starts false -- the character always spawns airborne at [0, 15, 0]
  // and free-falls, and Player.tsx overwrites this with the real value
  // within its first couple of frames regardless.
  isPlayerGrounded: false,
  testScene: 'none',
  missionStage: 0,
  missionStatus: 'inactive',
  missionTitle: '',
  missionBriefing: '',
  missionTimeRemaining: 0,
  missionTargetPos: null,
  entities: new Map(),
  setHealth: (health) => set({ health }),
  setMaxHealth: (maxHealth) => set({ maxHealth }),
  setArmor: (armor) => set({ armor }),
  takeDamage: (amount) => set((state) => ({ health: Math.max(0, state.health - amount) })),
  setMissionStage: (stage) => set({ missionStage: stage }),
  setMissionStatus: (status) => set({ missionStatus: status }),
  setMissionInfo: (title, briefing) => set({ missionTitle: title, missionBriefing: briefing }),
  setMissionTimeRemaining: (t) => set({ missionTimeRemaining: t }),
  setMissionTargetPos: (pos) => set({ missionTargetPos: pos }),
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
  setIsPlayerGrounded: (grounded) => set((state) => (state.isPlayerGrounded === grounded ? state : { isPlayerGrounded: grounded })),
  setTestScene: (testScene) => set({ testScene }),
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
