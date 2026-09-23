import { DEFAULT_RAGDOLL_BENCH, type RagdollBenchSettings } from "./components/Environment/ragdoll/ragdollBench";
import { create } from 'zustand';
import type { GameMode } from './components/Environment/SquadArenaTypes';

export type ControllableType = 'player' | 'car' | 'airplane' | 'helicopter' | 'drone' | 'combatSoldier';
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
  // "il personaggio si trasforma nel drone ... ha le stesse funzioni di
  // volo" (droneWorld) -- global so both Player.tsx (which drives it) and
  // useThirdPersonCamera.ts (which needs to know whether the mouse should
  // pilot the drone or orbit the camera, see there) can read it without
  // threading a prop between two independently-mounted hooks.
  isDrone: boolean;
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
  testScene: 'none' | 'airplane' | 'helicopter' | 'car' | 'race' | 'duel';
  // "fammi scegliere ... le modalita di scontro dei manichini" -- which
  // CombatArena.tsx duel mode is active (TERRITORY_CONTROL/TEAMS/FFA, same
  // three options simulation-citta's own "Modalita Scontro" dropdown had --
  // see CombatArenaGUI.tsx). Lives here (rather than local state inside
  // CombatArena) so the lil-gui panel, which is NOT a child of the R3F
  // scene tree, can change it.
  arenaGameMode: GameMode;
  // "da un minimo di 0 a 120 combattenti" -- total fighter count across
  // ALL of CombatArena.tsx's clusters combined (split as evenly as
  // possible between them), mirroring simulation-citta's own "Combattenti"
  // range slider (there capped at min 2; 0 is allowed here so the arena can
  // be switched off entirely). See CombatArenaGUI.tsx.
  arenaFighterCount: number;
  // "fai che gli attacchi sembrino veri e il combattimento sembri vero" --
  // the 1v1 duel's own HUD (DuelHUD.tsx) reads these three every frame to
  // draw two HP bars + a win/lose banner. Written every frame by
  // DuelArena.tsx from the two FighterData objects it owns (see
  // PlayerCombatSoldier.tsx/CombatSoldier.tsx, which mutate those in
  // place) -- kept here rather than read directly off the FighterData refs
  // because DuelHUD.tsx lives in the plain DOM overlay, outside the R3F
  // tree that owns those objects.
  duelPlayerHp: number;
  duelEnemyHp: number;
  duelResult: 'none' | 'win' | 'lose';
  // "metti un mirino cosi' so dove sto per colpire" -- true whenever the
  // duel player is currently close enough to the AI for a swing to land
  // (mirrors PlayerCombatSoldier.tsx's own ATTACK_RANGE check), written
  // every frame alongside the rest of this block by DuelArena.tsx so
  // DuelHUD.tsx's crosshair can recolor itself without reaching into the
  // R3F-owned FighterData refs directly.
  duelInRange: boolean;
  // "il mirino e' ai piedi del giocatore.. deve stare piu' in alto" --
  // screen-space position (0-100%, from top-left) of the duel crosshair,
  // computed by DuelArena.tsx's useFrame by projecting a point roughly at
  // the player's own chest/eye height through the active camera. Needed
  // because useThirdPersonCamera.ts's own lookAt target sits at the
  // player's ground-level root with no vertical offset for on-foot
  // controllers (unlike vehicles), so literal screen-center (what a naive
  // crosshair would use) lines up with the player's feet, not their
  // torso. Defaults to dead-center (50/50) until the very first frame
  // resolves a real value.
  duelReticleX: number;
  duelReticleY: number;
  // "aggiungi il tasto retry" -- bumped by retryDuel() below; Scene.tsx
  // passes it as DuelArena's own React `key`, so changing it unmounts the
  // old (dead/won) fight and mounts a brand new one -- fresh FighterData,
  // fresh position/hp/ragdoll state -- without leaving testScene='duel'
  // or touching the menu at all.
  duelRound: number;
  // "metti un opzione in cui l'avversario si ferma e non combatte che
  // posso attivare a piacimento" -- a training-dummy toggle the player
  // flips on/off mid-match from DuelHUD's own UI. Lives here (rather than
  // directly on the enemy's FighterData, which DuelHUD can't reach --
  // it's outside the R3F tree) purely as the bridge: DuelArena.tsx's own
  // useFrame mirrors this onto enemyData.isPassive every frame (same
  // "store value in, plain FighterData field out" direction already used
  // for duelReticleX/Y, just reversed), and CombatSoldier.tsx only ever
  // reads data.isPassive, never this store -- keeping the freeze scoped
  // to that one fighter instance, never leaking into CombatArena.tsx's
  // own (unrelated) 120 AI fighters.
  duelDummyMode: boolean;
  // "fai riferimenti visivi per ragdoll e fisica dei solidi" -- toggles
  // live wireframe capsules over each fighter's real 11 solid-body
  // colliders (useRagdoll.ts's resolveBodyMovement) AND the bag's own
  // solid collider, so what's ACTUALLY colliding is visible, not just
  // trusted from numbers -- read every frame by PlayerCombatSoldier.tsx/
  // CombatSoldier.tsx/PunchingBag.tsx, flipped from CombatArenaGUI.tsx's
  // debug panel (same bridge pattern as duelDummyMode just above).
  showPhysicsDebug: boolean;
  // "ma secondo me c sn doppi corpi solidi" -- showPhysicsDebug sopra
  // pilotava GIA' SolidBodyDebugView.tsx (il layer solid-body, 15
  // capsule) E ActiveRagdollDebugView.tsx (il layer fisico attivo, 17
  // capsule -- vedi useRagdollActive.ts) insieme, sovrapposti sullo
  // stesso personaggio senza modo di isolarli: impossibile capire se
  // quello che sembra un "corpo doppio" fosse solo i due layer disegnati
  // uno sopra l'altro o un bug vero. Flag separato apposta, cosi' si
  // possono accendere uno alla volta dal pannello Arena e confrontare.
  showActiveRagdollDebug: boolean;
  // "cazzo metti il personaggio a T osservalo" -- ferma l'AnimationMixer
  // e forza lo skeleton alla bind pose (T-pose) ogni frame invece
  // dell'animazione normale, cosi' i collider di debug si possono
  // ispezionare contro una posa statica e nota invece che contro
  // un'animazione in movimento. Letto da PlayerCombatSoldier.tsx.
  tPoseDebug: boolean;
  // "crea un tasto aggiungi nemico invece di aggiungerlo subito" --
  // DuelArena.tsx montava SEMPRE il CombatSoldier avversario appena si
  // entrava nel duello, aggiungendo un secondo intero set di collider
  // alla scena e complicando l'ispezione del solo giocatore. Default
  // false (nessun avversario finche' non lo chiedi esplicitamente dal
  // pannello Arena, pulsante "Aggiungi nemico").
  duelEnemySpawned: boolean;
  // "aggiungi la possibilita' di attivare la vista ortogonale" -- vedi
  // DebugOrthoCamera.tsx. Quando true prende il controllo della camera
  // del Canvas (drei's makeDefault) al posto della terza persona
  // normale -- utile per ispezionare un personaggio fermo (T-pose) senza
  // la distorsione prospettica, che rende difficile giudicare ad occhio
  // se un collider e' davvero allineato o solo sembra esserlo per via
  // dell'angolazione.
  debugOrthoCamera: boolean;
  // Angolo (gradi) attorno al personaggio da cui la vista ortogonale
  // guarda -- 0 = frontale, 90/180/270 = laterale/retro/laterale
  // opposto. Cambiato dal pulsante "Ruota vista 90'" del pannello Arena,
  // cosi' si puo' girare attorno al personaggio un lato alla volta senza
  // dover trascinare/orbitare manualmente una camera vera.
  debugOrthoCameraAngleDeg: number;
  // "sistema l'ambiente per fare i test come si deve" -- tutti i
  // parametri del banco di prova del ragdoll attivo, vedi ragdollBench.ts.
  ragdollBench: RagdollBenchSettings;
  // "togli tutta la merda ui in piu' che nn c'entra con questo test..
  // mettila disabilitata di default ma abilitabile tramite checkbox in
  // lil gui" -- Controls/StatusBars/MissionHUD/Minimap/il messaggio di
  // benvenuto (App.tsx) sono pensati per l'open-world, non per isolare i
  // test sul ragdoll nel duello: default OFF, riattivabile dal pannello
  // Arena come showPhysicsDebug qui sopra.
  showGameplayHud: boolean;
  // "fai un checkbox in cui il ragdoll diventa passivo e cade
  // stramazzato" -- spegne di netto i motori PD del layer ragdoll attivo
  // (nessuna coppia/molla che insegue l'animazione) cosi' il corpo resta
  // in piedi solo per gravita'+giunti, esattamente come il rig di
  // morte/hit-pulse ma per il layer sempre-attivo -- utile per verificare
  // a occhio che collider/giunti da soli reggano un corpo credibile,
  // isolato da qualunque bug di tuning dei motori.
  ragdollPassive: boolean;
  // "questo mi sembra piu' sostenibile" -- layer PD sempre attivo (vedi ragdollConfig.ts's RAGDOLL_HIPS_POSITION_STIFFNESS) per i duellanti. Toggle live per il tuning (GUI "Ragdoll attivo (PD)") senza dover ricaricare la pagina ogni volta.
  euphoriaRagdollEnabled: boolean;
  // "crea un sacco su cui allenarmi nell'arena.. mi serve per capire la
  // precisione delle collisioni" -- a static practice target (see
  // PunchingBag.tsx), completely separate from the AI opponent/dummy
  // above. Bridged into the store the same way (PunchingBag.tsx calls
  // registerBagHit directly, an imperative one-off event rather than a
  // per-frame mirror, since a hit is a discrete moment, not continuous
  // state) so DuelHUD.tsx (outside the R3F tree) can show a live readout.
  // bagHitCount is a running total; bagLastHit* describe only the MOST
  // RECENT hit, in meters, for reading exact collision precision:
  // radialOffset = horizontal distance from the bag's own vertical
  // centerline (0 = dead center, positive = off to either side, sign
  // doesn't matter since it's a radius), heightOffset = signed vertical
  // distance from the bag's own center height (positive = above center).
  bagHitCount: number;
  bagLastHitRadialOffset: number | null;
  bagLastHitHeightOffset: number | null;
  bagLastHitHand: 'hand_l' | 'hand_r' | null;
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
  setIsDrone: (isDrone: boolean) => void;
  setPaused: (paused: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsCrosshairVisible: (visible: boolean) => void;
  setPlayerInfo: (pos: [number, number, number], yaw: number) => void;
  setPlayerMessage: (message: string) => void;
  setCollectiblesTotal: (total: number) => void;
  setIsPlayerGrounded: (grounded: boolean) => void;
  setTestScene: (scene: 'none' | 'airplane' | 'helicopter' | 'car' | 'race' | 'duel') => void;
  setArenaGameMode: (mode: GameMode) => void;
  setArenaFighterCount: (count: number) => void;
  setDuelStatus: (playerHp: number, enemyHp: number, result: 'none' | 'win' | 'lose', inRange: boolean, reticleX: number, reticleY: number) => void;
  toggleDuelDummyMode: () => void;
  setDuelDummyMode: (active: boolean) => void;
  setShowPhysicsDebug: (active: boolean) => void;
  setShowActiveRagdollDebug: (active: boolean) => void;
  setTPoseDebug: (active: boolean) => void;
  setDuelEnemySpawned: (active: boolean) => void;
  setDebugOrthoCamera: (active: boolean) => void;
  setDebugOrthoCameraAngleDeg: (deg: number) => void;
  setRagdollBench: (partial: Partial<RagdollBenchSettings>) => void;
  setShowGameplayHud: (active: boolean) => void;
  setRagdollPassive: (active: boolean) => void;
  setEuphoriaRagdollEnabled: (active: boolean) => void;
  registerBagHit: (radialOffset: number, heightOffset: number, hand: 'hand_l' | 'hand_r') => void;
  retryDuel: () => void;
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
  isDrone: false,
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
  arenaGameMode: 'TERRITORY_CONTROL',
  arenaFighterCount: 20,
  duelPlayerHp: 100,
  duelEnemyHp: 100,
  duelResult: 'none',
  duelInRange: false,
  duelReticleX: 50,
  duelReticleY: 50,
  duelRound: 0,
  duelDummyMode: false,
  showPhysicsDebug: false,
  showActiveRagdollDebug: false,
  tPoseDebug: false,
  duelEnemySpawned: false,
  debugOrthoCamera: false,
  debugOrthoCameraAngleDeg: 0,
  ragdollBench: { ...DEFAULT_RAGDOLL_BENCH },
  showGameplayHud: false,
  ragdollPassive: false,
  euphoriaRagdollEnabled: true,
  bagHitCount: 0,
  bagLastHitRadialOffset: null,
  bagLastHitHeightOffset: null,
  bagLastHitHand: null,
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
  setIsDrone: (isDrone) => set({ isDrone }),
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
  setArenaGameMode: (arenaGameMode) => set({ arenaGameMode }),
  setArenaFighterCount: (arenaFighterCount) => set({ arenaFighterCount }),
  setDuelStatus: (duelPlayerHp, duelEnemyHp, duelResult, duelInRange, duelReticleX, duelReticleY) => set({ duelPlayerHp, duelEnemyHp, duelResult, duelInRange, duelReticleX, duelReticleY }),
  toggleDuelDummyMode: () => set((state) => ({ duelDummyMode: !state.duelDummyMode })),
  setDuelDummyMode: (duelDummyMode) => set({ duelDummyMode }),
  setShowPhysicsDebug: (showPhysicsDebug) => set({ showPhysicsDebug }),
  setShowActiveRagdollDebug: (showActiveRagdollDebug) => set({ showActiveRagdollDebug }),
  setTPoseDebug: (tPoseDebug) => set({ tPoseDebug }),
  setDuelEnemySpawned: (duelEnemySpawned) => set({ duelEnemySpawned }),
  setDebugOrthoCamera: (debugOrthoCamera) => set({ debugOrthoCamera }),
  setDebugOrthoCameraAngleDeg: (debugOrthoCameraAngleDeg) => set({ debugOrthoCameraAngleDeg }),
  setRagdollBench: (partial) => set((state) => ({ ragdollBench: { ...state.ragdollBench, ...partial } })),
  setShowGameplayHud: (showGameplayHud) => set({ showGameplayHud }),
  setRagdollPassive: (ragdollPassive) => set({ ragdollPassive }),
  setEuphoriaRagdollEnabled: (euphoriaRagdollEnabled) => set({ euphoriaRagdollEnabled }),
  registerBagHit: (radialOffset, heightOffset, hand) => set((state) => ({
    bagHitCount: state.bagHitCount + 1,
    bagLastHitRadialOffset: radialOffset,
    bagLastHitHeightOffset: heightOffset,
    bagLastHitHand: hand,
  })),
  retryDuel: () => set((state) => ({
    duelRound: state.duelRound + 1,
    duelPlayerHp: 100,
    duelEnemyHp: 100,
    duelResult: 'none',
    // Deliberately NOT reset here -- "attivare a piacimento" reads as a
    // practice-session setting the player controls, not per-round combat
    // state, so it should survive a retry same as e.g. audio/graphics
    // settings would, until the player turns it off themselves.
  })),
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
