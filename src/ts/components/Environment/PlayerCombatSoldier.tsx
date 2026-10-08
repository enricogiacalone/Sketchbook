import { setCameraFocus, clearCameraFocus } from '../../lib/cameraFocus';
import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '../../lib/gltf';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';
import { useRagdoll } from './ragdoll/useRagdoll';
import SolidBodyDebugView from './SolidBodyDebugView';
import ActiveRagdollDebugView from './ActiveRagdollDebugView';
import { useInput } from '../../hooks/useInput';
import WeaponWheelController from '../UI/WeaponWheelController';
import { FighterData, AnimCatalog } from './SquadArenaTypes';
import type { PunchingBagHandle } from './PunchingBag';
import { useStore } from '../../store';
import { locomotionTuning as LT, RUN_CLIP, timeScaleFor, speedFor, strafeClipFor, CLIP_GROUND_SPEED } from './locomotion';
import { LEFT_CONTACT, newLocoState, stepLoco, locoWeights } from './gtaLocomotion';
import { useRapier } from '@react-three/rapier';
import { usePistolModel, useGunModel, RIFLE_SPEC, type GunModelApi } from './weapons/usePistolModel';
import { useKnifeModel } from './weapons/useKnifeModel';
import { solveTwoBoneIK } from './weapons/twoBoneIK';
import { applyFootIK, newFootIK } from './footIK';
import { stepAt, stepTopAt } from './stairSteps';
import { newTravState, stepTraversal, followGround, isTraversing, hangHandTargets, type TravCtx } from './traversal/traversal';
import { GETUP_CLIP } from './ragdoll/knockdown';
import { useKnockdown } from './ragdoll/useKnockdown';
import { K, KIMODO_ANIMS_URL } from '../../lib/kimodo';
import { crowdPanic } from '../city/crowdSim';
import { castShot, spreadDirection } from './weapons/hitscan';
import { getShootableCollider, applyFighterHit } from './weapons/shootableRegistry';
import { registerFighterBlast, applyKnockdownBlast } from '../../lib/explosions';
import { raycastProxies } from '../../lib/shotProxies';
import { crowdAgents, promoteCrowdAgent } from '../city/crowdSim';
import { emitShotFx, type ShotSurface } from './weapons/weaponFx';
import {
  PISTOL_MAG_SIZE,
  PISTOL_FIRE_INTERVAL_S,
  PISTOL_RELOAD_FALLBACK_S,
  PISTOL_RELOAD_S,
  PISTOL_RANGE_M,
  PISTOL_SPREAD_HIP_DEG,
  PISTOL_SPREAD_AIM_DEG,
  PISTOL_RAISE_AFTER_SHOT_S,
  PISTOL_DAMAGE_BY_SEGMENT,
  PISTOL_DAMAGE_LIMB,
  PISTOL_HIT_SPEED_BY_SEGMENT,
  PISTOL_HIT_SPEED_LIMB,
  PISTOL_WORLD_IMPULSE,
  RIFLE_MAG_SIZE,
  RIFLE_FIRE_INTERVAL_S,
  RIFLE_RANGE_M,
  RIFLE_SPREAD_HIP_DEG,
  RIFLE_SPREAD_AIM_DEG,
  RIFLE_DAMAGE_BY_SEGMENT,
  RIFLE_DAMAGE_LIMB,
  RIFLE_HIT_SPEED_BY_SEGMENT,
  RIFLE_HIT_SPEED_LIMB,
  RIFLE_WORLD_IMPULSE,
  KNIFE_DAMAGE_SLASH,
  KNIFE_DAMAGE_HEAVY,
  KNIFE_DAMAGE_BLOCKED,
} from './weapons/weaponConfig';

// Armi del duello: 1 pugni, 2 pistola, 3 fucile (Galil), 4 coltello (M9).
export type WeaponKind = 'fists' | 'pistol' | 'rifle' | 'knife';
type GunKind = 'pistol' | 'rifle';
interface GunStats {
  mag: number;
  interval: number;
  auto: boolean; // tenendo premuto continua a sparare
  range: number;
  spreadHip: number;
  spreadAim: number;
  dmg: Record<string, number>;
  dmgLimb: number;
  hitSpeed: Record<string, number>;
  hitSpeedLimb: number;
  worldImpulse: number;
}
const GUN_STATS: Record<GunKind, GunStats> = {
  pistol: {
    mag: PISTOL_MAG_SIZE,
    interval: PISTOL_FIRE_INTERVAL_S,
    auto: false,
    range: PISTOL_RANGE_M,
    spreadHip: PISTOL_SPREAD_HIP_DEG,
    spreadAim: PISTOL_SPREAD_AIM_DEG,
    dmg: PISTOL_DAMAGE_BY_SEGMENT,
    dmgLimb: PISTOL_DAMAGE_LIMB,
    hitSpeed: PISTOL_HIT_SPEED_BY_SEGMENT,
    hitSpeedLimb: PISTOL_HIT_SPEED_LIMB,
    worldImpulse: PISTOL_WORLD_IMPULSE,
  },
  rifle: {
    mag: RIFLE_MAG_SIZE,
    interval: RIFLE_FIRE_INTERVAL_S,
    auto: true,
    range: RIFLE_RANGE_M,
    spreadHip: RIFLE_SPREAD_HIP_DEG,
    spreadAim: RIFLE_SPREAD_AIM_DEG,
    dmg: RIFLE_DAMAGE_BY_SEGMENT,
    dmgLimb: RIFLE_DAMAGE_LIMB,
    hitSpeed: RIFLE_HIT_SPEED_BY_SEGMENT,
    hitSpeedLimb: RIFLE_HIT_SPEED_LIMB,
    worldImpulse: RIFLE_WORLD_IMPULSE,
  },
};
// Coltello: fendenti alternati col tasto principale, colpo pesante con E
// (e Q per il terzo fendente); parata con la guardia della spada.
const KNIFE_SLASH_CLIPS = ['Sword_Regular_A', 'Sword_Regular_B'];
const KNIFE_THIRD_CLIP = 'Sword_Regular_C';
const KNIFE_HEAVY_CLIP = 'Sword_Attack';
const KNIFE_IDLE_CLIP = 'Idle_Sword';
const KNIFE_BLOCK_CLIP = 'Sword_Block';
const PUNCH_DAMAGE = 25;
const KNIFE_LUNGE_S = 0.3;
// ostacoli in movimento: sopra questa velocita' nel punto di contatto il
// personaggio viene colpito e spinto (m/s); la spinta si smorza cosi'
const OBSTACLE_HIT_MIN_SPEED = 1.2;
const OBSTACLE_KNOCK_MAX_SPEED = 6;
const OBSTACLE_KNOCK_DECAY = 5; // 1/s
const OBSTACLE_HIT_COOLDOWN_S = 0.6;
// sopra questa velocita' l'ostacolo non fa solo barcollare: KO fisico
const OBSTACLE_KNOCKDOWN_SPEED = 3.5;
const KNIFE_HEAVY_KNOCKDOWN_SPEED = 4.5;
// morto: dopo quanti secondi ci si rialza (niente schermata di sconfitta)
const PLAYER_REVIVE_S = 4;
const KNIFE_LUNGE_SPEED = 1.5; // m/s -> ~45 cm di passo
const _support = new THREE.Vector3();

// "estrai la pistola... aggiungilo al nostro personaggio" -- animazioni a
// strati: con la pistola in mano le GAMBE fanno camminata/corsa/strafe e
// la parte ALTA del corpo tiene la posa Pistol_* (Idle/Aim/Shoot/Reload,
// clip che il nostro personaggio ha gia'). Ogni clip viene divisa in due
// copie con tracce disgiunte (ossa basse / ossa alte), cosi' le due
// azioni del mixer non si mescolano mai sulla stessa osso.
const LOWER_BODY_BONE = /^(root|pelvis|thigh|calf|foot|ball)/i;
function splitClip(clip: THREE.AnimationClip, part: 'legs' | 'upper'): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => {
    const bone = t.name.split('.')[0];
    const lower = LOWER_BODY_BONE.test(bone);
    return part === 'legs' ? lower : !lower;
  });
  return new THREE.AnimationClip(`${clip.name}__${part}`, clip.duration, tracks);
}
const PISTOL_BASE_CLIPS = ['Pistol_Idle', 'Walk', 'Walk_Backwards', 'Strafe_left', 'Strafe_right', RUN_CLIP, 'Sprint', 'Jog'];
const PISTOL_UPPER_CLIPS = ['Pistol_Idle', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload'];
// timeScale delle clip di camminata direzionali (Walk / Walk_Backwards /
// Strafe_*): la velocita' viene dalla clip (locomotion.ts), cosi' avanti,
// indietro e di lato hanno ognuno la sua velocita' senza pattinare.
// indietro e di lato vanno piu' piano che in avanti (stessa cadenza, passi
// piu' corti: Walk_Backwards 0.82x, Strafe 0.68x la velocita' in avanti)
const dirWalkTs = () => timeScaleFor('Walk', LT.walkSpeed);
const aimWalkTs = () => timeScaleFor('Walk', LT.aimWalkSpeed);
// "sta in posizione di combattimento solo quando aggancio un nemico, per il
// resto in idle normale": idle rilassato del rig (il primo che esiste)
const RELAXED_IDLE_CLIPS = ['Idle_A', 'Idle_Subtle', 'Idle'];
// "la posizione di riposo va in contrasto con il salire le scale cercando di
// mettere sempre il piede destro dietro quello sinistro": Idle_A tiene il
// destro 39 cm dietro il sinistro (misurato), su una scala vuol dire uno o
// due gradini piu' in basso. Sulle scale il riposo e' Idle_Subtle (piedi
// quasi pari: 11 cm), stesso stile.
const STAIRS_IDLE_CLIPS = ['Idle_Subtle', 'Idle'];
const PISTOL_FACE_TURN_RATE = 0.3;
const PISTOL_SHOOT_ANIM_S = 0.22;
const _shotCamDir = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _bodyFwd = new THREE.Vector3();
const _bodyRight = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _chest = new THREE.Vector3();
// --- auto (vedi il blocco "Auto" in useFrame) ---
type VehMode = 'none' | 'toDoor' | 'opening' | 'entering' | 'driving' | 'exiting';
// Driving (clip): bacino 0.54 m sopra la radice e 0.31 m dietro. seat_1 e'
// la superficie del sedile: radice = sedile - 0.44 m (sotto il bacino di
// ~10 cm c'e' il sedere) + 0.31 m in avanti
const CAR_SEAT_FWD = 0.31;
const CAR_SEAT_DOWN = 0.44;
const CAR_ENTER_RANGE = 2.5;
const CAR_OPEN_S = 0.8;
const CAR_ENTER_S = 1.2;
const CAR_EXIT_S = 1.1;
const CAR_EXIT_MAX_SPEED = 2.5;
// portiera del guidatore per tipo di veicolo, e quota massima (m, dal punto
// d'ingresso al suolo) per scendere dall'elicottero
const VEH_DOOR = { car: 'door_1', helicopter: 'door_L' } as const;
// radice del personaggio rispetto al nodo seat_1: l'elicottero ha il
// pavimento piu' alto rispetto al sedile (con gli stessi numeri dell'auto i
// piedi uscivano sotto la cabina)
const VEH_SEAT = { car: { fwd: CAR_SEAT_FWD, down: CAR_SEAT_DOWN }, helicopter: { fwd: 0.24, down: 0.26 } } as const;
const HELI_EXIT_MAX_HEIGHT = 1.2;
const _carQuat = new THREE.Quaternion();
const _carQ2 = new THREE.Quaternion();
const _carQ3 = new THREE.Quaternion();
const _carFwd = new THREE.Vector3();
const _carUp = new THREE.Vector3();
const _carTmp = new THREE.Vector3();
const _carTmp2 = new THREE.Vector3();
const _carEuler = new THREE.Euler();
const _yawPi = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

const _tFwd = new THREE.Vector3();
const _tRight = new THREE.Vector3();
const _tMove = new THREE.Vector3();
const _hangL = new THREE.Vector3();
const _hangR = new THREE.Vector3();

// Banco ragdoll: clip che si possono ripetere in loop senza salti (le
// altre vengono riprodotte una volta e poi si torna in guardia).
const BENCH_LOOPING_CLIP = /^(Walk|Run|Sprint|Jog|Strafe|Fighting Idle|Idle|Crouch|Defend)/i;

const MODEL_URL = 'soldier-citizen.glb';
const BASE_ANIMS_URL = 'soldier-citizen-base-animations.glb';
const ADDON_ANIMS_URL = 'soldier-citizen-addon-animations.glb';
// "introduci kimodo così cominciamo con le animazioni custom": clip generate
// da Kimodo (testo -> animazione) e adattate a questo scheletro da
// tools/kimodo/kimodo.sh + scripts/kimodo-retarget.mjs (src/ts/lib/kimodo.ts).
// Si chiamano Kimodo_<nome> e si provano dal pannello "Animazioni Kimodo".
// "stati del personaggio": camminata da ferito sotto il 30% di vita,
// fiatone dopo una lunga corsa, esultanza quando si mette KO l'ultimo nemico
// vicino. Tutto solo se la clip c'e' e a mani nude (con un'arma in mano il
// busto segue la posa dell'arma); muoversi interrompe fiatone ed esultanza.
const INJURED_HP = 0.3;
const INJURED_WALK_SPEED = 0.95; // m/s
const TIRED_SPRINT_S = 4; // secondi di corsa di fila per avere il fiatone
const OUT_OF_BREATH_S = 4;
const CELEBRATE_DELAY_S = 0.8;
const CELEBRATE_NO_ENEMY_DIST = 15;

// Green -- visually distinct from CombatSoldier.tsx's RED/BLUE/amber-FFA
// team palette, so the fighter YOU control always reads unambiguously at
// a glance even though it's the exact same model/rig as the AI opponent.
const PLAYER_COLOR = '#22c55e';

// WALK_SPEED / RUN_SPEED ora vengono da locomotion.ts (misurate sulle clip)
// A little more forgiving than the AI's own 1.4 melee-range check
// (CombatSoldier.tsx) -- the AI measures distance itself every frame and
// only swings when already in range, but a human mashing the attack
// button doesn't have that luxury, so a swing thrown a hair too far away
// still plays (a "whiff") instead of silently doing nothing.
export const ATTACK_RANGE = 1.8; // exported so DuelArena.tsx can drive the crosshair's in-range state off the same number
// "quell'animazione non serve piu'" -- the Hit_Chest/Hit_Head clips used to
// be what SOLD a hit (a full-body stagger animation), but useRagdoll.ts's
// pulseHit now does that physically on the struck bone itself, and the
// clips' own baked-in motion (however small on paper) was the real source
// of "il personaggio si trasla in aria" -- it was already happening before
// the ragdoll rig existed at all. So a hit no longer switches the whole
// body's animation: it keeps playing whatever the fighter was already
// doing (idle/walk/attack) and lets the ragdoll pulse alone read as the
// reaction, while this constant keeps the old brief "can't act right after
// being hit" stagger window (matches HIT_BLEND_OUT_DURATION in
// useRagdoll.ts so the lock roughly tracks how long the ragdoll's own
// recoil is still visibly playing out).
const HIT_STAGGER_DURATION = 0.35;
const DODGE_SPEED = 7.5; // units/sec while the roll's physically covering ground
const DODGE_EXTRA_LOCK = 0.35; // extra cooldown (seconds) tacked on after the roll animation itself finishes, so it can't be chained instantly
// Max torso tilt (either direction) applied from camera pitch -- see the
// facing/lean block in the main useFrame below. Kept comfortably short of
// 90 deg so looking straight up/down doesn't fold the spine in half.
const SPINE_LEAN_MAX = THREE.MathUtils.degToRad(40);
// Max torso TWIST (left/right) applied from camera yaw, relative to
// wherever the legs are currently facing -- see the same block. Wider
// than the pitch clamp, matches useRagdoll.ts's own SPINE_TWIST_MAX_RAD
// (kept here too, redundant-safe, same reasoning as SPINE_LEAN_MAX).
const SPINE_TWIST_MAX = THREE.MathUtils.degToRad(80);
// torsione del busto: quanto ci mette a sparire a terra / rientrare in piedi (s)
const SPINE_LEAN_BLEND_S = 0.35;
// How much of the remaining facing-angle gap closes per frame -- same
// convention/units as CombatSoldier.tsx's own duel-facing turn (there
// 0.15); a touch snappier here since this is player-driven, not an
// ambient AI's idle turn. "le gambe nn devono ruotare secondo l'orbit
// control" -- the legs turn to square up with the opponent on their own
// again (torso aim is handled separately, see applySpineLean below).
const FACE_TURN_RATE = 0.22;

// Module-level scratch objects -- avoids a per-frame allocation burst,
// matching this file's siblings (City.tsx's _windowDummy, CombatSoldier's
// _hitImpulseDir, useRagdoll.ts's _v1/_v2/...).
const _hitImpulseDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
// Separate from _forward -- this one runs at the very top of useFrame
// (see the camPitch/applySpineLean block there), before _forward's own
// later read/flatten for yaw+movement, so the two must not share a
// scratch object (an early aim read would otherwise get clobbered the
// moment the later block reruns camera.getWorldDirection into the same
// vector, or vice versa depending on call order).
const _camAimDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _toOpponent = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _handPos = new THREE.Vector3(); // scratch for checkAttackContact's hand-bone reads

// "il colpo deve essere sferrato dove effettivamente le mesh collidono,
// non in un range" -- checked via a real Rapier shape-intersection query
// (useRagdoll.ts's pointIntersectsHurtbox) against the opponent's actual
// hurtbox collider, not a hand-rolled distance formula.
const ATTACK_HAND_BONES = ['hand_l', 'hand_r'] as const;
// col coltello i punti di contatto sono la punta e la meta' della lama
const KNIFE_PROBES = ['knife_tip', 'knife_mid'] as const;
type AttackProbe = (typeof ATTACK_HAND_BONES)[number] | (typeof KNIFE_PROBES)[number];

// altezza sopra i piedi pubblicata come posizione del giocatore (store)
const PLAYER_INFO_Y = 0.5;

interface PlayerCombatSoldierProps {
  // Owned by DuelArena.tsx, same FighterData shape CombatSoldier.tsx
  // mutates in place -- the AI opponent's own unmodified attack-resolution
  // code writes hp/triggerHit/isDead directly onto this object, exactly as
  // it would for any other fighter it's targeting.
  data: FighterData;
  // I FighterData dei nemici IA -- letti qui per facing/lock-on/parata, e
  // modificati direttamente quando il giocatore mette a segno un colpo
  // (vedi finalizePendingHit), come fa CombatSoldier.tsx col suo
  // `theTarget`. "il bottone aggiungi nemico deve aggiungere un nemico
  // nuovo tutte le volte che lo premo" -- una LISTA (anche vuota), non piu'
  // un solo avversario: il pugno colpisce chiunque tocchi davvero, il
  // lock-on aggancia il piu' vicino ancora vivo.
  opponents: FighterData[];
  // Must match the id passed to setCurrentControllable('combatSoldier', id)
  // so useThirdPersonCamera's scene.getObjectByName(...) can find this
  // group -- see useThirdPersonCamera.ts.
  entityName: string;
  globalSpeed: number;
  // "crea un sacco su cui allenarmi.. mi serve per capire la precisione
  // delle collisioni" -- optional second target, entirely independent of
  // `opponent` above (see PunchingBag.tsx). Both undefined/null when
  // DuelArena.tsx's own bag collider hasn't reported its handle yet (its
  // very first frame or two) -- checkAttackContact below just skips the
  // bag check in that case, same "not there yet" handling the opponent's
  // own hurtboxHandle already needs.
  bagHurtboxHandle?: number | null;
  bagRef?: React.RefObject<PunchingBagHandle | null>;
  // "se sbatto col sacco dovrei muoverlo" -- the bag's SOLID collider
  // handle (not the sensor one above), so resolveBodyMovement can tell
  // "the thing that just blocked one of my 11 real body-part colliders
  // IS the bag" and push it for real instead of just stopping. Same
  // "not there yet" null handling as bagHurtboxHandle.
  bagSolidHandle?: number | null;
  // auto guidabili dell'arena (id del RigidBody di Car.tsx): F vicino alla
  // portiera del guidatore -> ci si sale e si guida
  vehicleIds?: string[] | (() => string[]);
  // Tipo di controllo "a piedi": 'combatSoldier' nel duello, 'player' nel
  // playground (dove Drone.tsx, pedoni, minimappa ecc. parlano di 'player').
  // Mentre il controllo e' altrove (drone) il manichino resta fermo in idle.
  footControllable?: 'combatSoldier' | 'player';
  // B: prende il controllo del drone compagno (Drone.tsx) -- solo playground
  droneId?: string;
  // pubblica posizione/direzione nello store (minimappa, missioni, nemici,
  // drone che segue): lo faceva Player.tsx (il boxman)
  publishPlayerInfo?: boolean;
}

// The player-input-driven half of the 1v1 duel -- "siamo io che controllo
// un combat soldier contro un altro combat soldier". Deliberately NOT a
// thin wrapper around CombatSoldier.tsx (that component's whole frame
// loop is an AI state machine reading `data`/`allFightersData` on its
// own timer) -- this duplicates just its animation-catalog setup and
// damage-resolution formulas (kept byte-for-byte identical on purpose, so
// a punch lands the same whichever side threw it) and replaces the AI
// decision tree with real input.
//
// Movement is camera-relative, the same technique Player.tsx's own
// on-foot movement uses (state.camera.getWorldDirection() projected
// flat). Facing (the legs/whole body) is back to auto-locking onto the
// opponent -- "le gambe nn devono ruotare secondo l'orbit control" --
// using the same atan2(...)+PI convention and smoothed turn CombatSoldier
// .tsx's AI uses for its own target-facing, so both fighters read
// consistently. Aiming is the TORSO's job instead: spine_02/03 lean/twist
// with the camera (see the camPitch/camYaw block in useFrame below,
// applied via useRagdoll's applySpineLean), independent of which way the
// legs are currently facing -- so punches can be aimed in 2D without
// spinning the whole body around to do it.
const PlayerCombatSoldier: React.FC<PlayerCombatSoldierProps> = ({
  data,
  opponents,
  entityName,
  globalSpeed,
  bagHurtboxHandle,
  bagRef,
  bagSolidHandle,
  vehicleIds,
  footControllable = 'combatSoldier',
  droneId,
  publishPlayerInfo = false,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  // Points at the SkeletonUtils clone (set below) so useRagdoll can walk
  // its bone hierarchy -- see CombatSoldier.tsx for why this is a ref
  // rather than reading `clone` directly (useRagdoll must be called
  // unconditionally, before `clone` exists on the very first render).
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  // "cazzo metti il personaggio a T osservalo" -- riferimento allo
  // skeleton VERO (non solo la mappa di bone di resolveBones) cosi' il
  // useFrame qui sotto puo' chiamare .pose() ogni frame per tenerlo in
  // bind pose (T-pose) quando tPoseDebug e' attivo -- vedi
  // CombatArenaGUI.tsx's checkbox "T-pose (ferma animazione)". Trovato
  // una volta sola (il primo SkinnedMesh dentro clone, stesso schema
  // gia' usato per clonedScene.traverse qui sopra), non ogni frame.
  const skeletonRef = useRef<THREE.Skeleton | null>(null);
  const lastBenchClipRef = useRef<string | null>(null);
  const benchCycleRef = useRef<{ oneShot: boolean; phase: 'clip' | 'rest'; t: number }>({ oneShot: false, phase: 'clip', t: 0 });
  // Unlike CombatSoldier.tsx (opt-in via `enableRagdoll`, off for the
  // city-wide arena's up-to-120 fighters), the duel always has exactly
  // one player -- no perf reason to ever skip this here.
  const ragdoll = useRagdoll(modelRootRef, data.id);
  const input = useInput();
  const { camera, scene: threeScene } = useThree();
  const { world, rapier } = useRapier();
  // Pistola (vedi weapons/): modello agganciato alla mano destra e stato
  // dell'arma. Refs, non stato React: tutto vive nel loop di useFrame.
  const pistol = usePistolModel(modelRootRef);
  const rifle = useGunModel(modelRootRef, RIFLE_SPEC);
  const knife = useKnifeModel(modelRootRef);
  const weaponRef = useRef<WeaponKind>('fists');
  const ammoRef = useRef<Record<GunKind, number>>({ pistol: PISTOL_MAG_SIZE, rifle: RIFLE_MAG_SIZE });
  const reloadGunRef = useRef<GunKind>('pistol');
  const meleeDamageRef = useRef(PUNCH_DAMAGE);
  const knifeSlashRef = useRef(0);
  // affondo: col coltello il colpo porta avanti di un passo (la lama e'
  // corta, senza il passo i fendenti passavano a 35-40 cm dal bersaglio)
  const knifeLungeLeftRef = useRef(0);
  // ostacoli dell'arena che colpiscono il personaggio: spinta residua (m/s)
  // e pausa tra un colpo e l'altro dello stesso ostacolo
  const knockVelRef = useRef(new THREE.Vector3());
  const obstacleHitCooldownRef = useRef(0);
  const spineLeanWRef = useRef(1); // peso della torsione del busto (0 a terra)
  // salto / arrampicata (traversal/traversal.ts): quota dei piedi, modo...
  const travRef = useRef(
    newTravState(
      getTerrainHeight(data.position.x, data.position.z) + getRoadOffset(data.position.x, data.position.z) + data.position.y,
      data.position.x,
      data.position.z
    )
  );
  const traving = () => isTraversing(travRef.current);
  // salire in auto / guidare / scendere (vedi il blocco "Auto" in useFrame)
  const vehRef = useRef<{
    mode: VehMode;
    carId: string | null;
    t: number;
    from: THREE.Vector3;
    fromQuat: THREE.Quaternion;
    // posizione dell'auto al frame prima (velocita' per poter scendere)
    carPrev: THREE.Vector3;
    carSpeed: number;
    // "fallo usare al nostro personaggio": auto o elicottero (stesso modo di
    // salire: portiera del guidatore, sedile seat_1)
    kind: 'car' | 'helicopter';
  }>({
    mode: 'none',
    kind: 'car',
    carId: null,
    t: 0,
    from: new THREE.Vector3(),
    fromQuat: new THREE.Quaternion(),
    carPrev: new THREE.Vector3(),
    carSpeed: 0,
  });
  // seduti dentro l'auto (o mentre si entra/esce): niente ragdoll attivo --
  // il corpo segue il sedile, la fisica del corpo dentro l'abitacolo in
  // movimento non avrebbe senso
  const inCarBody = () => vehRef.current.mode === 'entering' || vehRef.current.mode === 'driving' || vehRef.current.mode === 'exiting';
  const deadForRef = useRef(0);
  const maxHpRef = useRef(data.hp);
  // locomozione alla GTA IV (gtaLocomotion.ts): velocita' con inerzia,
  // curve, inclinazione, e il "mixer" di fermo/camminata/corsa in fase
  const locoRef = useRef(newLocoState());
  const footIKRef = useRef(newFootIK());
  // passo accorciato sulle scale (vedi il movimento libero e footIK.ts)
  const strideRef = useRef({ scale: 1, fwdX: 0, fwdZ: 1, rootX: 0, rootZ: 0 });
  const locoBlendRef = useRef<{ active: boolean; clips: string[]; blendIn: number }>({ active: false, clips: [], blendIn: 0 });
  // stati Kimodo (vedi INJURED_HP e seguenti)
  const sprintTimeRef = useRef(0);
  const breathLeftRef = useRef(0);
  const celebrateRef = useRef<{ delay: number; left: number }>({ delay: 0, left: 0 });
  const scheduleCelebration = (victim: FighterData) => {
    const nearEnemy = opponents.some(
      (o) =>
        o !== victim && !o.isDead && Math.hypot(o.position.x - data.position.x, o.position.z - data.position.z) < CELEBRATE_NO_ENEMY_DIST
    );
    if (!nearEnemy) celebrateRef.current = { delay: CELEBRATE_DELAY_S, left: 0 };
  };
  const isDown = () => kd.isDown() || data.state === 'Si rialza';
  type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D };
  const armBonesRef = useRef<{ l: Arm; r: Arm } | null>(null);
  const rifleRaiseRef = useRef(0);
  const isGun = () => weaponRef.current === 'pistol' || weaponRef.current === 'rifle';
  const gunKind = (): GunKind => (weaponRef.current === 'rifle' ? 'rifle' : 'pistol');
  const gunApi = (k: GunKind = gunKind()): GunModelApi => (k === 'rifle' ? rifle : pistol);
  const reloadLeftRef = useRef(0);
  const reloadDurRef = useRef(PISTOL_RELOAD_FALLBACK_S);
  const fireCooldownRef = useRef(0);
  const raiseLeftRef = useRef(0);
  const shootAnimLeftRef = useRef(0);
  const aimingRef = useRef(false);
  const upperActionRef = useRef<string | null>(null);
  const weaponStoreRef = useRef({ w: '', a: false, n: -1, r: false });

  // Extra dodge-spam cooldown (see DODGE_EXTRA_LOCK) and which way the
  // current roll is heading -- both need to survive across frames without
  // triggering a re-render, hence refs, matching `data`'s own mutate-in-
  // place convention.
  const dodgeLockRef = useRef(0);
  const dodgeDirRef = useRef(new THREE.Vector3());
  const isDodgingRef = useRef(false);
  // Track the CURRENT swing's own state -- isAttacking distinguishes an
  // attack's attackLock window from a dodge's or a hit-stagger's (all
  // three reuse the same data.attackLock timer), and hasLanded makes sure
  // a single swing can only land once even though the contact check now
  // runs every frame it's active (see checkAttackContact below).
  const isAttackingRef = useRef(false);
  const attackHasLandedRef = useRef(false);

  const { scene } = useGLTF(MODEL_URL);
  const { animations: baseAnims } = useGLTF(BASE_ANIMS_URL);
  const { animations: addonAnims } = useGLTF(ADDON_ANIMS_URL);
  const { animations: kimodoAnims } = useGLTF(KIMODO_ANIMS_URL);
  const animations = useMemo(() => [...baseAnims, ...addonAnims, ...kimodoAnims], [baseAnims, addonAnims, kimodoAnims]);

  // Identical to CombatSoldier.tsx's own catalog-building useMemo (see
  // there for why each field is picked the way it is) -- duplicated
  // rather than shared because it's not exported as a hook there, and
  // pulling it out into one would touch a file that's already working and
  // used by up to 120 city-wide fighters.
  const { clone, mixer, actions, clipsMap, animCatalog } = useMemo(() => {
    const clonedScene = SkeletonUtils.clone(scene);

    clonedScene.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(PLAYER_COLOR);
        child.material.emissiveIntensity = 0.35;
        // "a volte quando cade scompare e poi riappare": il volume di
        // visibilita' del modello e' quello della posa a riposo attorno
        // alla radice, che durante il KO resta ferma mentre il corpo vola
        // via in ragdoll -- con la telecamera che segue il corpo, la radice
        // usciva dall'inquadratura e il modello veniva scartato. Uno solo,
        // si disegna sempre.
        child.frustumCulled = false;
      }
    });

    const animMixer = new THREE.AnimationMixer(clonedScene);
    const actMap: Record<string, THREE.AnimationAction> = {};
    const cMap: Record<string, THREE.AnimationClip> = {};

    animations.forEach((clip) => {
      const action = animMixer.clipAction(clip);
      actMap[clip.name] = action;
      cMap[clip.name] = clip;
    });
    // "scavalca/sali": ClimbUp_1m_RM porta la radice su di 0.94 m e avanti
    // di 1.57 m (root motion) e all'ultimo fotogramma torna all'inizio.
    // Copia in-place (senza root.position, fino a 0.625 s): la posizione la
    // decide traversal.ts, deformata sul bordo vero (motion warping).
    if (cMap['ClimbUp_1m_RM']) {
      const src = cMap['ClimbUp_1m_RM'];
      const c = new THREE.AnimationClip(
        'ClimbUp_1m__ip',
        0.625,
        src.tracks.filter((t) => t.name !== 'root.position')
      );
      actMap[c.name] = animMixer.clipAction(c);
      cMap[c.name] = c;
    }
    // Posa di caduta per le cadute lunghe: i primi 0.29 s di Land_Three_Point
    // sono proprio la caduta da cui parte quell'atterraggio, ma col bacino
    // 4 m piu' in alto (la caduta e' "cotta" nella traccia del bacino). Copia
    // con il bacino fermo alla quota che ha all'istante del contatto (0.46 s):
    // in aria resta la posa, e l'atterraggio (che parte da 0.46 s) si
    // raccorda senza salti.
    if (cMap['Land_Three_Point']) {
      const src = cMap['Land_Three_Point'];
      const sub = THREE.AnimationUtils.subclip(src, 'Fall_Air__ip', 0, 7, 24);
      const pelvisSrc = src.tracks.find((t) => t.name === 'pelvis.position');
      const pelvisSub = sub.tracks.find((t) => t.name === 'pelvis.position');
      // senza traccia del bacino la posa resterebbe 4 m in alto: niente clip
      if (pelvisSrc && pelvisSub) {
        const at = (pelvisSrc as THREE.VectorKeyframeTrack)
          .InterpolantFactoryMethodLinear(new Float32Array(3))
          .evaluate(0.46) as Float32Array;
        for (let i = 0; i < pelvisSub.values.length; i += 3) {
          pelvisSub.values[i] = at[0];
          pelvisSub.values[i + 1] = at[1];
          pelvisSub.values[i + 2] = at[2];
        }
        actMap[sub.name] = animMixer.clipAction(sub);
        cMap[sub.name] = sub;
      }
    }
    // Copie "solo gambe" / "solo busto" per la pistola (vedi splitClip).
    for (const name of PISTOL_BASE_CLIPS) {
      if (!cMap[name]) continue;
      const c = splitClip(cMap[name], 'legs');
      actMap[c.name] = animMixer.clipAction(c);
      cMap[c.name] = c;
    }
    for (const name of PISTOL_UPPER_CLIPS) {
      if (!cMap[name]) continue;
      const c = splitClip(cMap[name], 'upper');
      actMap[c.name] = animMixer.clipAction(c);
      cMap[c.name] = c;
    }

    const pickAnim = (candidates: string[], fallback = 'Fighting Idle') => {
      for (const name of candidates) {
        if (actMap[name]) return name;
      }
      return fallback;
    };

    const catalog: AnimCatalog = {
      idle: pickAnim(['Fighting Idle', 'Idle']),
      run: pickAnim([RUN_CLIP, 'Run', 'Sprint', 'Walk']),
      walk: pickAnim(['Walk', 'Run']),
      dodge: pickAnim(['Roll_Forward', 'Roll_Back', 'Dodge_back', 'Dodge_Left']),
      block: pickAnim(['Block', 'Defend', 'Fighting Idle']),
      taunt: pickAnim(['Taunt', 'Cheering', 'Victory']),
      victory: pickAnim(['Victory', 'Taunt']),
      death: pickAnim(['Death_D', 'Death_A', 'Death']),
      // "il colpo va lo stesso a segno" -- 'Kick_Right'/'Spin_Kick'/
      // 'Kick_Left'/'Uppercut' don't exist anywhere in this rig's base or
      // addon animation packs (verified against both GLBs' own clip
      // lists), so pickAnim silently fell back to 'Fighting Idle' for 2 of
      // these 4 slots: half of all random attack picks played no visible
      // swing at all while the damage/hit-reaction logic below fired
      // unconditionally regardless of which clip (if any) actually
      // played. Replaced with three more real punch/hook variants this
      // rig actually has, so all four slots always animate.
      attacks: [
        pickAnim(['Punch_Jab', 'Fighting Left Jab']),
        pickAnim(['Punch_Cross', 'Fighting Right Jab']),
        pickAnim(['Melee_Hook', 'Punch_Jab']),
        pickAnim(['Fighting Right Jab', 'Fighting Left Jab']),
      ],
      // "dividi i colpi in piu tasti cosi riesco a sceglierli" -- three
      // distinct, deterministic strikes the player picks directly (see
      // the three attack blocks in useFrame below), instead of one
      // button randomly drawing from `attacks` above (which the AI still
      // does, unchanged).
      attackJab: pickAnim(['Punch_Jab', 'Fighting Left Jab']),
      attackCross: pickAnim(['Punch_Cross', 'Fighting Right Jab']),
      attackHook: pickAnim(['Melee_Hook', 'Punch_Jab']),
    };

    if (actMap[catalog.idle]) {
      actMap[catalog.idle].play();
      data.currentAnim = catalog.idle;
    }
    // The AI's own block-detection check reads `theTarget.animCatalog?.block`
    // (CombatSoldier.tsx) -- without this the AI could never tell the
    // player was blocking.
    data.animCatalog = catalog;

    return { clone: clonedScene, mixer: animMixer, actions: actMap, clipsMap: cMap, animCatalog: catalog };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, animations, data]);

  // KO fisico e rialzo: lo stesso pezzo dei nemici e della citta' (ragdoll/useKnockdown.ts)
  const kd = useKnockdown(ragdoll, scene, clipsMap[GETUP_CLIP]);
  // (l'alzata del rialzo vale solo mentre ci si rialza davvero)
  const getUpLift = () => (data.state === 'Si rialza' ? kd.lift() : 0);
  // a terra (KO o morto): la telecamera segue il bacino del ragdoll, non la
  // radice rimasta dov'era (lib/cameraFocus.ts)
  const _focus = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const down = kd.isDown() || data.isDead;
    if (down && ragdoll.getBoneWorldPosition('pelvis', _focus)) setCameraFocus(entityName, _focus);
    else clearCameraFocus(entityName);
  });
  React.useEffect(() => () => clearCameraFocus(entityName), [entityName]);
  // colpo forte: KO fisico (vedi ragdoll/knockdown.ts)
  // esplosioni (lib/explosions.ts): danno, KO o morte con la spinta; non
  // dentro un veicolo o pilotando il drone
  React.useEffect(
    () =>
      registerFighterBlast(data, ragdoll, () => kd.isDown(), {
        present: () => {
          const c = useStore.getState().currentControllable;
          return c === 'player' || c === 'combatSoldier';
        },
        onDamage: (n) => useStore.getState().takeDamage(n),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );

  const startKnockdown = (dirX: number, dirZ: number, speed: number, up = 0.3) => {
    if (kd.isDown() || data.isDead) return;
    if (!kd.start(dirX, dirZ, speed, up)) return;
    data.state = 'A terra';
    data.attackLock = 0;
    isAttackingRef.current = false;
    isDodgingRef.current = false;
    pendingHitRef.current = null;
    knockVelRef.current.set(0, 0, 0);
    aimingRef.current = false;
  };

  React.useEffect(() => {
    modelRootRef.current = clone;
    // Zero dei giunti del ragdoll attivo = la guardia (vedi captureClipPose).
    ragdoll.setNeutralClip(clipsMap[animCatalog.idle] ?? null);
    skeletonRef.current = null;
    clone.traverse((child: any) => {
      if (!skeletonRef.current && child.isSkinnedMesh) {
        skeletonRef.current = child.skeleton as THREE.Skeleton;
      }
    });
  }, [clone]);

  // "sistema l'ambiente per fare i test come si deve" -- API del banco di
  // prova del ragdoll attivo, usata dai pulsanti del pannello "Banco
  // ragdoll" (CombatArenaGUI.tsx) e dagli script di verifica dal vivo.
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const bench = {
      clipNames: () =>
        Object.keys(clipsMap)
          .filter((n) => !n.includes('__'))
          .sort(),
      clipDuration: (n: string) => clipsMap[n]?.duration ?? null,
      report: () => ragdoll.getActiveRagdollDebugSegments(),
      measureClips: (names?: string[]) => {
        const list = (names && names.length ? names : Object.keys(clipsMap)).map((n) => clipsMap[n]).filter(Boolean);
        return ragdoll.measureClipRanges(list);
      },
      // Colpo di prova che arriva dalla direzione della camera (spinge il
      // segmento lontano dalla camera), cosi' chi guarda vede subito da
      // che parte deve piegarsi.
      hit: (segment: string, speed?: number) => {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        dir.normalize();
        dir.y = 0.1;
        return ragdoll.testActiveHit(segment, dir, speed ?? useStore.getState().ragdollBench.testHitSpeed);
      },
    };
    (window as any).__ragdollBench = bench;
    return () => {
      if ((window as any).__ragdollBench === bench) delete (window as any).__ragdollBench;
    };
  }, [clipsMap, ragdoll, camera]);

  // fine del mescolamento della locomozione (qualunque altra animazione):
  // le clip del passo si dissolvono, quella che resta (se e' tra loro) va a
  // peso pieno
  const endLocoBlend = (target: string, duration: number) => {
    const lb = locoBlendRef.current;
    if (!lb.active) return;
    lb.active = false;
    for (const c of lb.clips) {
      const a = actions[c];
      if (!a) continue;
      if (c === target) {
        a.stopFading();
        a.setEffectiveTimeScale(1);
        a.setEffectiveWeight(1);
      } else a.fadeOut(duration);
    }
    clone.rotation.z = 0;
    // un colpo, una schivata, la parata... fermano il passo
    locoRef.current.speed = 0;
    locoRef.current.lean = 0;
  };

  const transitionToAnimation = (animName: string, duration = 0.15, shouldLoop = true, timeScale = 1.0, startAt = 0) => {
    const target = actions[animName] ? animName : animCatalog.idle;
    if (!target || !actions[target]) return 1.0;
    endLocoBlend(target, duration);

    if (data.currentAnim === target) {
      actions[target].setEffectiveTimeScale(timeScale);
      if (shouldLoop) return clipsMap[target]?.duration || 1.0;
      actions[target].reset();
      actions[target].time = startAt;
      actions[target].play();
      return clipsMap[target]?.duration || 1.0;
    }

    const prevAction = actions[data.currentAnim];
    const nextAction = actions[target];

    if (prevAction) prevAction.fadeOut(duration);

    nextAction.reset();
    nextAction.time = startAt;
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1);
    nextAction.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
    nextAction.clampWhenFinished = !shouldLoop;
    nextAction.fadeIn(duration);
    nextAction.play();

    data.currentAnim = target;
    return clipsMap[target]?.duration || 1.0;
  };

  // "il colpo deve essere sferrato dove effettivamente le mesh collidono"
  // -- called every frame a swing is active (see the attackLock branch in
  // useFrame below), checks THIS fighter's own hand bones (both -- no
  // per-clip left/right mapping is tracked/needed: provato dal vivo nel
  // browser lanciando Jab/Hook/Cross contro il sacco, e' SEMPRE la stessa
  // mano ad arrivare vicina al bersaglio da un dato angolo -- il sistema
  // di aim del busto, non il nome del colpo, decide quale mano si
  // avvicina davvero, quindi controllarle entrambe e' corretto, non un
  // ripiego) against `opponent`'s body cylinder.
  //
  // "il colpo deve avvenire dove colpisce la mano" -- provato dal vivo:
  // risolvere il colpo al PRIMO frame in cui la mano sfiora appena il
  // bordo esterno del volume di query (query generosa apposta, per non
  // "bucare" il bersaglio tra un frame e l'altro) lo faceva registrare
  // mentre la mano era ancora a meta' del suo affondo -- un Jab sul sacco
  // ha registrato il colpo a 0.26m dal centro, ma la stessa mano ha
  // continuato ad avvicinarsi fino a 0.21m circa 150ms dopo, prima di
  // ritirarsi. Fix: quando una mano ENTRA nel volume non si risolve
  // subito -- resta "pending" (vedi pendingHitRef sotto) e si continua a
  // tracciarla frame per frame finche' resta dentro, aggiornando la
  // posizione registrata; si applica il colpo vero e proprio solo quando
  // la mano ESCE di nuovo, usando l'ULTIMA posizione ancora a contatto --
  // cioe' il punto di affondo piu' profondo realmente raggiunto, non il
  // primo sfioramento. Returns true solo il frame in cui il colpo viene
  // effettivamente risolto (puo' essere diversi frame dopo il primo
  // contatto) -- il caller usa questo per latchare attackHasLandedRef.
  const pendingHitRef = useRef<{
    bone: AttackProbe;
    kind: 'opponent' | 'bag';
    pos: THREE.Vector3;
    // il nemico toccato (solo per kind === 'opponent')
    target?: FighterData;
  } | null>(null);

  // Applica la risoluzione vera e propria (danno/marker) usando il punto
  // di affondo piu' profondo tracciato in pendingHitRef, poi lo svuota.
  // Separata da checkAttackContact cosi' sia il percorso normale ("la
  // mano e' appena uscita dal volume") sia la rete di sicurezza qui sotto
  // (lo swing finisce mentre la mano e' ANCORA dentro, quindi non c'e'
  // mai un frame "appena uscita" a farla scattare) possono richiamarla.
  const finalizePendingHit = (): boolean => {
    const pending = pendingHitRef.current;
    pendingHitRef.current = null;
    if (!pending) return false;
    if (pending.kind === 'opponent' && pending.target) {
      const opponent = pending.target;
      // Damage/blocking/death formulas copied VERBATIM from
      // CombatSoldier.tsx's own attack-resolution branch, on purpose --
      // a punch does the same thing whichever fighter threw it.
      const withKnife = pending.bone === 'knife_tip' || pending.bone === 'knife_mid';
      if (withKnife) knife.playHit();
      if (opponent.currentAnim === opponent.animCatalog?.block) {
        opponent.hp -= withKnife ? KNIFE_DAMAGE_BLOCKED : 5;
        opponent.state = 'Danno parato!';
      } else {
        opponent.hp -= meleeDamageRef.current;
        // affondo pesante col coltello: colpo forte -> KO fisico
        if (withKnife && meleeDamageRef.current >= KNIFE_DAMAGE_HEAVY && opponent.hp > 0) {
          const dx = opponent.position.x - data.position.x,
            dz = opponent.position.z - data.position.z;
          const l = Math.hypot(dx, dz) || 1;
          opponent.knockdown = { dirX: dx / l, dirZ: dz / l, speed: KNIFE_HEAVY_KNOCKDOWN_SPEED };
        }
        if (opponent.hp <= 0) {
          opponent.hp = 0;
          opponent.isDead = true;
          opponent.attackLock = 0;
          scheduleCelebration(opponent);
        } else {
          opponent.triggerHit = Math.random() > 0.5 ? 'Hit_Chest' : 'Hit_Head';
          // "il colpo deve avvenire precisamente dove le mesh si sono
          // toccate" -- il punto di affondo piu' profondo tracciato sopra,
          // non piu' solo "il primo punto di contatto".
          opponent.hitFromX = pending.pos.x;
          opponent.hitFromZ = pending.pos.z;
        }
      }
    } else if (pending.kind === 'bag') {
      // "crea un sacco su cui allenarmi nell'arena.. mi serve per capire
      // la precisione delle collisioni" -- stessa logica, contro il sacco.
      if (pending.bone === 'knife_tip' || pending.bone === 'knife_mid') knife.playHit();
      bagRef?.current?.registerHit(pending.pos, pending.bone === 'hand_l' ? 'hand_l' : 'hand_r');
    }
    return true;
  };

  // posizione mondo di un punto di contatto (osso della mano o lama)
  const probePos = (probe: AttackProbe, out: THREE.Vector3): boolean => {
    if (probe === 'knife_tip') {
      knife.getTipWorld(out);
      return true;
    }
    if (probe === 'knife_mid') {
      knife.getMidBladeWorld(out);
      return true;
    }
    return ragdoll.getBoneWorldPosition(probe, out);
  };

  const checkAttackContact = (): boolean => {
    // Gia' in contatto da un frame precedente di QUESTO stesso swing --
    // continua a tracciare la STESSA mano/bersaglio invece di riscandire
    // entrambe le mani (un colpo che sta gia' atterrando non deve
    // "cambiare mano" a meta' strada).
    if (pendingHitRef.current) {
      const pending = pendingHitRef.current;
      const stillIn =
        probePos(pending.bone, _handPos) &&
        (pending.kind === 'opponent'
          ? !!pending.target &&
            !pending.target.isDead &&
            pending.target.hurtboxHandle !== null &&
            ragdoll.pointIntersectsHurtbox(_handPos, pending.target.hurtboxHandle)
          : bagHurtboxHandle !== null && bagHurtboxHandle !== undefined && ragdoll.pointIntersectsHurtbox(_handPos, bagHurtboxHandle));
      if (stillIn) {
        pending.pos.copy(_handPos); // ancora dentro -- continua a tracciare, non risolto
        return false;
      }
      return finalizePendingHit(); // appena uscita -- risolvi ora, nel punto piu' profondo raggiunto
    }

    const probes: readonly AttackProbe[] = weaponRef.current === 'knife' ? KNIFE_PROBES : ATTACK_HAND_BONES;
    for (const boneName of probes) {
      if (!probePos(boneName, _handPos)) continue;

      let touched: FighterData | null = null;
      for (const opponent of opponents) {
        if (opponent.isDead || opponent.hurtboxHandle === null) continue;
        if (ragdoll.pointIntersectsHurtbox(_handPos, opponent.hurtboxHandle)) {
          touched = opponent;
          break;
        }
      }
      if (touched) {
        pendingHitRef.current = { bone: boneName, kind: 'opponent', pos: _handPos.clone(), target: touched };
        return false;
      }

      // "crea un sacco su cui allenarmi nell'arena.. mi serve per capire
      // la precisione delle collisioni" -- exact same real Rapier query
      // as the opponent check above, just against the bag's own hurtbox
      // collider (PunchingBag.tsx) instead. Landing on the bag never
      // affects the fight (no hp/opponent state touched at all) -- it
      // only feeds the bag's own hit counter/marker via registerHit.
      if (bagHurtboxHandle !== null && bagHurtboxHandle !== undefined && ragdoll.pointIntersectsHurtbox(_handPos, bagHurtboxHandle)) {
        pendingHitRef.current = { bone: boneName, kind: 'bag', pos: _handPos.clone() };
        return false;
      }
    }
    return false;
  };

  // Clip di locomozione per la direzione di _moveDir RISPETTO al corpo
  // (avanti / indietro / destra / sinistra), a un timeScale dato; la
  // velocita' e' quella misurata della clip (locomotion.ts). Corsa solo in
  // avanti. suffix '__legs' = solo gambe (pistola), '' = corpo intero.
  const pickDirectionalLoco = (run: boolean, ts: number, suffix: '' | '__legs') => {
    _bodyFwd.set(-Math.sin(data.rotation), 0, -Math.cos(data.rotation));
    _bodyRight.crossVectors(_bodyFwd, _worldUp);
    const f = _moveDir.dot(_bodyFwd);
    const r = _moveDir.dot(_bodyRight);
    if (run && f > 0.5 && actions[RUN_CLIP + suffix]) {
      return { clip: RUN_CLIP + suffix, speed: LT.runSpeed, ts: timeScaleFor(RUN_CLIP, LT.runSpeed), running: true };
    }
    let base: string;
    if (Math.abs(f) >= Math.abs(r)) base = f >= 0 ? 'Walk' : 'Walk_Backwards';
    else base = strafeClipFor(r > 0);
    if (!actions[base + suffix]) base = 'Walk';
    return { clip: base + suffix, speed: speedFor(base, ts), ts, running: false };
  };

  // --- Pistola -------------------------------------------------------
  // Clip "gambe" di riposo: con la pistola le gambe stanno ferme mentre il
  // busto tiene la posa Pistol_* sul layer alto.
  // Guardia (Fighting Idle) solo col lock-on su un nemico vivo; altrimenti
  // idle normale. Con la pistola le gambe stanno nella posa Pistol_Idle.
  const relaxedIdle = RELAXED_IDLE_CLIPS.find((n) => actions[n]) ?? animCatalog.idle;
  const stairsIdle = STAIRS_IDLE_CLIPS.find((n) => actions[n]) ?? relaxedIdle;
  const isEngaged = () => !!input.lockOn && opponents.some((o) => !o.isDead);
  const onStairs = () => stepTopAt(data.position.x, data.position.z, travRef.current.feetY) !== null;
  const idleName = () => {
    if (isGun() && actions['Pistol_Idle__legs']) return 'Pistol_Idle__legs';
    if (weaponRef.current === 'knife' && actions[KNIFE_IDLE_CLIP]) return KNIFE_IDLE_CLIP;
    if (isEngaged()) return animCatalog.idle;
    return onStairs() ? stairsIdle : relaxedIdle;
  };
  const idleState = () => (weaponRef.current === 'fists' && !isEngaged() ? 'Riposo' : 'In guardia');
  // Fermi: esultanza o fiatone (clip Kimodo) al posto del riposo. true se ha
  // scelto lei l'animazione di questo frame.
  const kimodoIdle = (dt: number): boolean => {
    if (weaponRef.current !== 'fists' || isEngaged()) {
      celebrateRef.current = { delay: 0, left: 0 };
      return false;
    }
    const c = celebrateRef.current;
    if (c.delay > 0) {
      c.delay -= dt;
      const clips = K.victory.filter((n) => actions[n]);
      if (c.delay <= 0 && clips.length) {
        c.left = transitionToAnimation(clips[Math.floor(Math.random() * clips.length)], 0.25, false);
        sprintTimeRef.current = 0;
      }
    }
    if (c.left > 0) {
      c.left -= dt;
      data.state = 'Esulta!';
      return true;
    }
    if (sprintTimeRef.current > TIRED_SPRINT_S && actions[K.outOfBreath]) breathLeftRef.current = OUT_OF_BREATH_S;
    sprintTimeRef.current = 0;
    if (breathLeftRef.current > 0) {
      breathLeftRef.current -= dt;
      transitionToAnimation(K.outOfBreath, 0.35, true);
      data.state = 'Fiatone';
      return true;
    }
    return false;
  };

  // la parata che l'IA riconosce (animCatalog.block) segue l'arma in mano
  const fistsBlockRef = useRef(animCatalog.block);
  const equipWeapon = (w: WeaponKind) => {
    if (weaponRef.current === w) return;
    weaponRef.current = w;
    reloadLeftRef.current = 0;
    shootAnimLeftRef.current = 0;
    raiseLeftRef.current = 0;
    aimingRef.current = false;
    for (const g of [pistol, rifle]) {
      g.setReloadProgress(null);
      g.stopReload();
    }
    animCatalog.block = w === 'knife' && actions[KNIFE_BLOCK_CLIP] ? KNIFE_BLOCK_CLIP : fistsBlockRef.current;
    // Se il personaggio e' libero, passa subito alla clip di riposo giusta
    // (altrimenti ci pensa la fine dell'attackLock).
    if (data.attackLock <= 0 && !data.isDead) transitionToAnimation(idleName(), 0.2, true);
  };

  // Layer alto (busto+braccia): una sola azione __upper attiva alla volta,
  // dissolvenze di pari durata cosi' i pesi sommano sempre a 1.
  const setUpperLayer = (name: string | null, restart = false) => {
    const cur = upperActionRef.current;
    if (cur === name && !restart) return;
    if (cur && cur !== name) actions[cur]?.fadeOut(0.15);
    upperActionRef.current = name;
    if (!name) return;
    const a = actions[name];
    if (!a) {
      upperActionRef.current = null;
      return;
    }
    const once = name.startsWith('Pistol_Reload') || name.startsWith('Pistol_Shoot');
    a.reset();
    a.setEffectiveTimeScale(name.startsWith('Pistol_Reload') ? (clipsMap[name]?.duration ?? 1) / reloadDurRef.current : 1);
    a.setEffectiveWeight(1);
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    if (cur === name) a.play();
    else a.fadeIn(restart ? 0.05 : 0.15).play();
  };

  const updateUpperLayer = (tPose: boolean) => {
    let desired: string | null = null;
    if (!tPose && isGun() && !data.isDead && !isDown() && data.state !== 'Vittoria!' && !isDodgingRef.current && !traving()) {
      desired =
        reloadLeftRef.current > 0
          ? 'Pistol_Reload__upper'
          : shootAnimLeftRef.current > 0
            ? 'Pistol_Shoot__upper'
            : aimingRef.current || raiseLeftRef.current > 0
              ? 'Pistol_Aim_Neutral__upper'
              : 'Pistol_Idle__upper';
    }
    setUpperLayer(desired);
  };

  const startReload = () => {
    const k = gunKind();
    if (reloadLeftRef.current > 0 || ammoRef.current[k] >= GUN_STATS[k].mag) return;
    reloadGunRef.current = k;
    // dura quanto il suono di ricarica (la clip Pistol_Reload viene
    // riscalata su questa durata in setUpperLayer)
    reloadDurRef.current = clipsMap['Pistol_Reload'] ? PISTOL_RELOAD_S : PISTOL_RELOAD_FALLBACK_S;
    reloadLeftRef.current = reloadDurRef.current;
    aimingRef.current = false;
    gunApi(k).playReload();
  };

  // Sparo hitscan in terza persona (schema TPS classico): 1) raggio dalla
  // camera attraverso il mirino (centro schermo) -> punto mirato;
  // 2) raggio vero dalla canna verso quel punto (cosi' un ostacolo tra
  // pistola e bersaglio blocca il colpo anche se la camera lo "vede").
  const fire = () => {
    const gk = gunKind();
    const st = GUN_STATS[gk];
    const gun = gunApi(gk);
    if (ammoRef.current[gk] <= 0) {
      startReload();
      return;
    }
    const aiming = aimingRef.current;
    // "folla piu' viva": i passanti vicini scappano o si accucciano
    crowdPanic(data.position.x, data.position.z);
    camera.getWorldDirection(_shotCamDir);
    spreadDirection(_shotCamDir, aiming ? st.spreadAim : st.spreadHip, _shotCamDir);
    // Il raggio camera parte all'altezza del personaggio lungo la linea di
    // mira, non dalla camera: un oggetto dietro le spalle non deve
    // "mangiarsi" il colpo.
    camera.getWorldPosition(_camPos);
    _chest.set(data.position.x, (groupRef.current?.position.y ?? 0) + 1.3, data.position.z);
    const t0 = Math.max(0, _toAim.subVectors(_chest, _camPos).dot(_shotCamDir));
    _camPos.addScaledVector(_shotCamDir, t0);
    const camHit = castShot(world, rapier, _camPos, _shotCamDir, st.range, data.id);
    // personaggi lontani senza fisica (sagome della folla, corpi parcheggiati):
    // anche loro fermano la mira (lib/shotProxies.ts)
    const camProxy = raycastProxies(_camPos, _shotCamDir, camHit.hit ? camHit.distance : st.range, data.id);
    if (camProxy) camHit.point.copy(_camPos).addScaledVector(_shotCamDir, camProxy.distance);

    gun.getMuzzleWorld(_muzzle);
    _shotDir.subVectors(camHit.point, _muzzle);
    const dist = _shotDir.length();
    // Bersaglio praticamente dentro la canna o alle spalle della pistola:
    // si spara lungo la linea della camera.
    if (dist < 0.05 || _shotDir.dot(_shotCamDir) <= 0) _shotDir.copy(_shotCamDir);
    else _shotDir.divideScalar(dist);
    const hit = castShot(world, rapier, _muzzle, _shotDir, st.range, data.id);

    let surface: ShotSurface = 'none';
    let decal = false;
    // un personaggio colpito (dal raggio fisico o dalle forme a conti)
    const hitFighter = (info: { ownerId: string; segment: string }, point: THREE.Vector3) => {
      surface = 'body';
      const seg = info.segment;
      const target = opponents.find((o) => o.id === info.ownerId);
      const head = seg === 'Head';
      let kill = false;
      if (target && !target.isDead) {
        target.hp -= st.dmg[seg] ?? st.dmgLimb;
        if (target.hp <= 0) {
          target.hp = 0;
          target.isDead = true;
          target.attackLock = 0;
          kill = true;
          scheduleCelebration(target);
        } else {
          target.triggerHit = head ? 'Hit_Head' : 'Hit_Chest';
          target.hitReactionHandled = true;
          target.hitFromX = _muzzle.x;
          target.hitFromZ = _muzzle.z;
        }
        useStore.getState().setPlayerWeaponState({ pistolHitAt: performance.now(), pistolHitKill: kill, pistolHitHead: head });
      }
      applyFighterHit(info.ownerId, seg, _shotDir, st.hitSpeed[seg] ?? st.hitSpeedLimb, point);
    };
    // prima del raggio fisico: personaggi lontani senza fisica
    const proxy = raycastProxies(_muzzle, _shotDir, hit.hit ? hit.distance : st.range, data.id);
    if (proxy) {
      const point = _muzzle.clone().addScaledVector(_shotDir, proxy.distance);
      if (proxy.crowdAgentId !== undefined) {
        // sagoma della folla: prende subito un corpo vero e il colpo
        surface = 'body';
        const agent = crowdAgents.find((a) => a.id === proxy.crowdAgentId);
        if (agent) {
          promoteCrowdAgent(agent, {
            seg: proxy.segment,
            dir: [_shotDir.x, _shotDir.y, _shotDir.z],
            point: [point.x, point.y, point.z],
            speed: st.hitSpeed[proxy.segment] ?? st.hitSpeedLimb,
            damage: st.dmg[proxy.segment] ?? st.dmgLimb,
          });
          useStore
            .getState()
            .setPlayerWeaponState({ pistolHitAt: performance.now(), pistolHitKill: false, pistolHitHead: proxy.segment === 'Head' });
        }
      } else hitFighter(proxy, point);
    } else if (hit.hit && hit.collider) {
      const info = getShootableCollider(hit.collider.handle);
      if (info) {
        hitFighter(info, hit.point);
      } else if (bagSolidHandle !== null && bagSolidHandle !== undefined && hit.collider.handle === bagSolidHandle) {
        surface = 'bag';
        bagRef?.current?.registerShot(hit.point, _shotDir);
      } else {
        surface = 'world';
        const body = hit.collider.parent();
        if (body && body.isDynamic()) {
          body.applyImpulseAtPoint(
            { x: _shotDir.x * st.worldImpulse, y: _shotDir.y * st.worldImpulse, z: _shotDir.z * st.worldImpulse },
            { x: hit.point.x, y: hit.point.y, z: hit.point.z },
            true
          );
        } else {
          decal = true;
        }
      }
    }
    if (import.meta.env.DEV) {
      (window as any).__lastShot = {
        surface,
        camHit: camHit.hit
          ? {
              d: +camHit.distance.toFixed(2),
              h: camHit.collider?.handle,
              info: camHit.collider ? getShootableCollider(camHit.collider.handle) : null,
            }
          : null,
        hit: hit.hit
          ? {
              d: +hit.distance.toFixed(2),
              h: hit.collider?.handle,
              info: hit.collider ? getShootableCollider(hit.collider.handle) : null,
              sensor: hit.collider?.isSensor(),
            }
          : null,
        muzzle: _muzzle.toArray().map((n) => +n.toFixed(2)),
        dir: _shotDir.toArray().map((n) => +n.toFixed(2)),
      };
    }
    emitShotFx({ from: _muzzle, to: hit.point, normal: hit.normal, surface, decal });
    gun.kick();
    gun.playShot();
    ammoRef.current[gk] -= 1;
    fireCooldownRef.current = st.interval;
    raiseLeftRef.current = PISTOL_RAISE_AFTER_SHOT_S;
    shootAnimLeftRef.current = PISTOL_SHOOT_ANIM_S;
    setUpperLayer('Pistol_Shoot__upper', true);
  };

  useFrame((_state, delta) => {
    if (data.knockdown) {
      const kdData = data.knockdown;
      startKnockdown(kdData.dirX, kdData.dirZ, kdData.speed, kdData.up);
      // esplosione: ogni pezzo del corpo dal centro (anche da morto)
      applyKnockdownBlast(kdData, ragdoll);
      data.knockdown = null;
    }

    // "cazzo metti il personaggio a T osservalo" -- quando attivo, NON
    // avanza l'animazione (l'idle/qualunque clip in corso resterebbe
    // comunque congelata al SUO frame corrente, non in T-pose) e forza
    // invece lo skeleton alla bind pose ogni frame (skeleton.pose() --
    // economico, sovrascrive solo le matrici delle ossa dai loro
    // bindMatrix, la stessa tecnica gia' usata altrove in questo
    // progetto per leggere una posa di riferimento "vera" senza toccare
    // l'animazione).
    // "metti il personaggio a T e sistema queste ossa della ragdoll
    // attiva" -- il ragdoll attivo ora RESTA ACCESO in T-pose: la T-pose
    // diventa semplicemente il BERSAGLIO dei motori (e' anche lo zero di
    // tutti i giunti, vedi activeRagdollFrames.ts), cosi' si verifica a
    // colpo d'occhio che i corpi fisici coincidano col personaggio.
    // Banco "Animazione di prova": una clip scelta dal pannello gira in
    // loop al posto della macchina a stati (vedi il return piu' sotto).
    const benchState = useStore.getState();
    // ruota delle armi (UI/WeaponWheel.tsx): aperta = niente attacchi/spari;
    // alla chiusura indossa l'arma scelta
    const wheelOpen = benchState.weaponWheelOpen;
    if (wheelOpen) {
      for (const a of ['primary', 'yawLeft', 'yawRight', 'attackLeft', 'weapon1', 'weapon2', 'weapon3', 'weapon4', 'dodge'])
        input.consumeJustPressed(a);
    }
    const tPoseBench = benchState.tPoseDebug;
    const benchClip = benchState.ragdollBench.benchClip;
    // Rimette nelle ossa la posa ANIMATA prima del mixer (vedi
    // restoreActiveAnimationPose): il bersaglio del ragdoll non deve mai
    // diventare la fisica del frame prima.
    ragdoll.beginFrame();
    if (benchClip !== lastBenchClipRef.current) {
      // Cambio di clip di prova: dissolvenza come nel gioco (un taglio
      // secco teletrasporterebbe il bersaglio e falserebbe le misure).
      const next = benchClip && actions[benchClip] ? benchClip : animCatalog.idle;
      const loops = !benchClip || BENCH_LOOPING_CLIP.test(next);
      transitionToAnimation(next, 0.2, loops);
      lastBenchClipRef.current = benchClip;
      benchCycleRef.current = { oneShot: !loops, phase: 'clip', t: 0 };
    } else if (benchClip && benchCycleRef.current.oneShot && !tPoseBench) {
      // Clip "una tantum" (pugni, schivate, colpi): in loop secco la posa
      // salterebbe dall'ultimo al primo fotogramma ogni giro (misurato:
      // il gancio dura 0.5s e ogni ripartenza teletrasportava il
      // bersaglio di 30 cm) -- falsando tutte le misure. Qui si ripete
      // come nel gioco: clip -> dissolvenza in guardia -> pausa -> clip.
      const cyc = benchCycleRef.current;
      cyc.t += delta * globalSpeed;
      const dur = clipsMap[benchClip]?.duration ?? 1;
      if (cyc.phase === 'clip' && cyc.t >= dur) {
        transitionToAnimation(animCatalog.idle, 0.25, true);
        cyc.phase = 'rest';
        cyc.t = 0;
      } else if (cyc.phase === 'rest' && cyc.t >= 0.8) {
        transitionToAnimation(benchClip, 0.15, false);
        cyc.phase = 'clip';
        cyc.t = 0;
      }
    }
    // Arma: cambio 1/2, timer, layer alto. Prima del mixer, cosi' il
    // layer scelto per questo frame e' gia' quello che viene campionato.
    {
      const benchMode = tPoseBench || !!benchClip;
      const dtW = delta * globalSpeed;
      if (!benchMode && !data.isDead) {
        if (input.consumeJustPressed('weapon1')) equipWeapon('fists');
        if (input.consumeJustPressed('weapon2')) equipWeapon('pistol');
        if (input.consumeJustPressed('weapon3')) equipWeapon('rifle');
        if (input.consumeJustPressed('weapon4')) equipWeapon('knife');
        if (benchState.requestedWeapon) {
          equipWeapon(benchState.requestedWeapon);
          benchState.setRequestedWeapon(null);
        }
      }
      if (fireCooldownRef.current > 0) fireCooldownRef.current -= dtW;
      if (raiseLeftRef.current > 0) raiseLeftRef.current -= dtW;
      if (shootAnimLeftRef.current > 0) shootAnimLeftRef.current -= dtW;
      if (reloadLeftRef.current > 0) {
        reloadLeftRef.current -= dtW;
        if (reloadLeftRef.current <= 0) {
          reloadLeftRef.current = 0;
          ammoRef.current[reloadGunRef.current] = GUN_STATS[reloadGunRef.current].mag;
          gunApi(reloadGunRef.current).setReloadProgress(null);
        } else {
          gunApi(reloadGunRef.current).setReloadProgress(1 - reloadLeftRef.current / reloadDurRef.current);
        }
      }
      if (!isGun() || data.isDead) aimingRef.current = false;
      if (data.isDead && reloadLeftRef.current > 0) {
        // morto a meta' ricarica: niente rumori di caricatore dal cadavere
        reloadLeftRef.current = 0;
        for (const g of [pistol, rifle]) {
          g.setReloadProgress(null);
          g.stopReload();
        }
      }
      updateUpperLayer(benchMode);
      pistol.setVisible(weaponRef.current === 'pistol' && !benchMode);
      pistol.update(dtW);
      rifle.setVisible(weaponRef.current === 'rifle' && !benchMode);
      // fucile: pronto basso -> in mira (anche subito dopo uno sparo)
      {
        const want = aimingRef.current || raiseLeftRef.current > 0 || shootAnimLeftRef.current > 0 ? 1 : 0;
        const k = Math.min(1, dtW * 8);
        rifleRaiseRef.current += (want - rifleRaiseRef.current) * k;
        rifle.setRaise(rifleRaiseRef.current);
      }
      rifle.update(dtW);
      knife.setVisible(weaponRef.current === 'knife' && !benchMode);
      knife.update();
      const ws = weaponStoreRef.current;
      const reloading = reloadLeftRef.current > 0;
      const ammoNow = isGun() ? ammoRef.current[gunKind()] : 0;
      if (ws.w !== weaponRef.current || ws.a !== aimingRef.current || ws.n !== ammoNow || ws.r !== reloading) {
        ws.w = weaponRef.current;
        ws.a = aimingRef.current;
        ws.n = ammoNow;
        ws.r = reloading;
        useStore.getState().setPlayerWeaponState({
          playerWeapon: weaponRef.current,
          playerAiming: aimingRef.current,
          pistolAmmo: ammoNow,
          pistolReloading: reloading,
        });
      }
    }
    if (tPoseBench) {
      skeletonRef.current?.pose();
    } else if (mixer) {
      mixer.update(delta * globalSpeed);
    }
    // "coglione testa su chrome" -- temporary live-browser debug readout
    // for the duel-player fighter's own internal state (input/attackLock/
    // triggerHit), so a javascript_tool script driving the real game can
    // see WHY movement might be blocked (e.g. a stuck attackLock) without
    // guessing. Same spirit/safety as DuelArena.tsx's own __duelDebug.
    (window as any).__pcsDebug = {
      input: { ...input },
      attackLock: data.attackLock,
      triggerHit: !!data.triggerHit,
      state: data.state,
      isDead: data.isDead,
      isAttacking: isAttackingRef.current,
      isDodging: isDodgingRef.current,
      posX: data.position.x,
      posZ: data.position.z,
      // salto/arrampicata (traversal.ts): modo, quota piedi, teletrasporto per le prove
      trav: {
        mode: travRef.current.mode,
        feetY: +travRef.current.feetY.toFixed(3),
        vy: +travRef.current.vy.toFixed(2),
        rot: +data.rotation.toFixed(3),
        anim: data.currentAnim,
        ledgeTop: travRef.current.ledge?.topY ?? null,
      },
      // Laboratorio KO (UI/koLab.ts): a terra / si sta rialzando, e KO vero
      // (stesso percorso di un colpo: rialzo automatico, telecamera)
      down: kd.isDown() || data.state === 'Si rialza',
      knockDown: (dirX: number, dirZ: number, speed: number, up?: number) => startKnockdown(dirX, dirZ, speed, up),
      teleport: (x: number, z: number, rotation?: number, feetY?: number) => {
        data.position.x = x;
        data.position.z = z;
        if (rotation !== undefined) data.rotation = rotation;
        if (feetY !== undefined) travRef.current.feetY = feetY;
        travRef.current.lastX = x;
        travRef.current.lastZ = z;
      },
      // solidSegments: ragdoll.getSolidBodySegments(),
      // "confronto layer per layer" -- richiesto dall'utente per
      // analizzare "i vari scheletri ad uno ad uno" (solid-body vs
      // active-ragdoll) dalla console live, senza dover accendere per
      // forza la ActiveRagdollDebugView a schermo.
      // getter: calcolato solo quando qualcuno lo legge (script di debug),
      // non a ogni frame.
      // locomozione alla GTA IV (gtaLocomotion.ts): velocita', fase, inclinazione
      get loco() {
        return { ...locoRef.current, blend: locoBlendRef.current.active, anim: data.currentAnim, rot: data.rotation };
      },
      get footIK() {
        const f = footIKRef.current;
        return { w: f.w, restAnkle: f.restAnkle, ...f.debug };
      },
      get activeSegments() {
        return ragdoll.getActiveRagdollDebugSegments();
      },
      // coltello: dove sono punta/lama e se toccano il sacco (debug dal vivo)
      knifeProbe: () => {
        const tip = knife.getTipWorld(new THREE.Vector3());
        const mid = knife.getMidBladeWorld(new THREE.Vector3());
        const bag = bagHurtboxHandle ?? null;
        return {
          tip: tip.toArray().map((n) => +n.toFixed(2)),
          mid: mid.toArray().map((n) => +n.toFixed(2)),
          tipInBag: bag !== null && ragdoll.pointIntersectsHurtbox(tip, bag),
          midInBag: bag !== null && ragdoll.pointIntersectsHurtbox(mid, bag),
          handInBag: bag !== null && ragdoll.getBoneWorldPosition('hand_r', _handPos) && ragdoll.pointIntersectsHurtbox(_handPos, bag),
          attacking: isAttackingRef.current,
          landed: attackHasLandedRef.current,
          pending: pendingHitRef.current?.bone ?? null,
        };
      },
    };
    // Spostato PRIMA di ragdoll.update(): la torsione/inclinazione del
    // busto fa parte della posa BERSAGLIO del ragdoll attivo (prima
    // veniva scritta dopo, sopra la fisica, e il busto fisico non la
    // seguiva mai). Saltata in T-pose / animazione di prova.
    // "l'orbit nn controlla bene il busto.. volevo direzionare i pugni in
    // questo modo.. il colpo deve davvero atterrare dove miro" -- runs
    // BEFORE any of the state branches below can return early, unlike
    // before (previously this lived after the attackLock>0 branch, so it
    // never ran DURING a swing at all -- exactly why aiming had no effect
    // on a punch). spine_02/03 are ancestors of the attacking hand in the
    // skeleton (spine -> clavicle -> upperarm -> lowerarm -> hand), so
    // leaning/twisting them here changes the hand's actual live world
    // position too -- and checkAttackContact's real Rapier query below
    // tests exactly that live position, so a punch genuinely lands where
    // the camera's pointed (both up/down AND left/right), not just
    // cosmetic idle sway. applySpineLean itself already no-ops during an
    // active ragdoll pulse/death, so this is safe to run unconditionally
    // rather than threading a guard through every return point below.
    //
    // "le gambe nn devono ruotare secondo l'orbit control" -- the legs
    // (data.rotation, set further below) now auto-face the opponent again
    // on their own, so the torso's yaw twist here is relative to THAT,
    // not the world: camYaw uses the same atan2(...)+PI convention as
    // data.rotation so the two are directly comparable, and yawDiff is
    // how far the camera's currently looking away from wherever the legs
    // are squared up -- exactly the "aim the punches independent of where
    // the body's facing" behaviour that was asked for. data.rotation here
    // is last frame's value (this block intentionally runs before this
    // frame's own leg-turn update below), which is fine -- one frame of
    // lag on a smoothed turn is imperceptible.
    camera.getWorldDirection(_camAimDir);
    const camPitch = Math.atan2(_camAimDir.y, Math.sqrt(_camAimDir.x * _camAimDir.x + _camAimDir.z * _camAimDir.z));
    const camYaw = Math.atan2(_camAimDir.x, _camAimDir.z) + Math.PI;
    let yawDiff = camYaw - data.rotation;
    yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
    // (niente torsione verso la camera mentre si salta/arrampica)
    // "a volte quando cade scompare e poi riappare, sembra cadere sotto il
    // suolo": la torsione SOSTITUISCE la rotazione animata della spina --
    // al rialzo (LayToIdle) il busto sdraiato e curvo della clip diventava
    // dritto e girato verso la telecamera, e le braccia finivano 30-35 cm
    // sotto il pavimento (il corpo fisico le seguiva). A terra e mentre si
    // rialza niente torsione; poi rientra piano.
    if (data.state === 'Si rialza') kd.tick(delta);
    else kd.stopLift();
    spineLeanWRef.current = THREE.MathUtils.clamp(
      spineLeanWRef.current + (isDown() || data.isDead ? -1 : 1) * (delta / SPINE_LEAN_BLEND_S),
      0,
      1
    );
    if (!tPoseBench && !benchClip && !traving() && !inCarBody())
      ragdoll.applySpineLean(
        THREE.MathUtils.clamp(camPitch, -SPINE_LEAN_MAX, SPINE_LEAN_MAX),
        THREE.MathUtils.clamp(yawDiff, -SPINE_TWIST_MAX, SPINE_TWIST_MAX),
        spineLeanWRef.current
      );
    // Fucile: e' agganciato al petto (calcio alla spalla, vedi
    // rifleHoldTuning) e le MANI vanno sull'arma: destra sull'impugnatura,
    // sinistra sull'astina (non durante la ricarica: va al caricatore).
    // Dopo la torsione del busto, prima del ragdoll: fa parte della posa
    // bersaglio.
    const rifleIK = () => {
      if (tPoseBench || benchClip || weaponRef.current !== 'rifle' || data.isDead || isDodgingRef.current || isDown() || traving()) return;
      if (!armBonesRef.current) {
        const get = (n: string) => clone.getObjectByName(n);
        const l = [get('upperarm_l'), get('lowerarm_l'), get('hand_l')];
        const r = [get('upperarm_r'), get('lowerarm_r'), get('hand_r')];
        if (l.every(Boolean) && r.every(Boolean)) {
          armBonesRef.current = {
            l: { upper: l[0]!, lower: l[1]!, hand: l[2]! },
            r: { upper: r[0]!, lower: r[1]!, hand: r[2]! },
          };
        }
      }
      const arms = armBonesRef.current;
      if (arms) {
        solveTwoBoneIK(arms.r.upper, arms.r.lower, arms.r.hand, rifle.getGripWorld(_support), 1);
        if (reloadLeftRef.current <= 0 && rifle.getSupportWorld(_support))
          solveTwoBoneIK(arms.l.upper, arms.l.lower, arms.l.hand, _support, 1);
      }
    };
    rifleIK();
    // appeso a un bordo: mani sul bordo vero (IK), qualunque sia la posa
    const hangIK = () => {
      if (!hangHandTargets(travRef.current, _hangL, _hangR)) return;
      if (!armBonesRef.current) {
        const get = (n: string) => clone.getObjectByName(n);
        const l = [get('upperarm_l'), get('lowerarm_l'), get('hand_l')];
        const r = [get('upperarm_r'), get('lowerarm_r'), get('hand_r')];
        if (!l.every(Boolean) || !r.every(Boolean)) return;
        armBonesRef.current = {
          l: { upper: l[0]!, lower: l[1]!, hand: l[2]! },
          r: { upper: r[0]!, lower: r[1]!, hand: r[2]! },
        };
      }
      const arms = armBonesRef.current;
      solveTwoBoneIK(arms.l.upper, arms.l.lower, arms.l.hand, _hangL, 1);
      solveTwoBoneIK(arms.r.upper, arms.r.lower, arms.r.hand, _hangR, 1);
    };
    hangIK();

    // Runs every frame regardless of which branch below fires, same
    // reasoning as CombatSoldier.tsx: a hit-reaction pulse needs to keep
    // simulating/blending out even once the rest of the state machine has
    // moved on.
    // "layer sempre attivo full-body" -- the human duel player always
    // opts in to the PD active-ragdoll layer when the GUI toggle is on
    // (there's no enableRagdoll-style gate for the player fighter -- this
    // component only ever renders the one duel player).
    // "In guardia" e' lo stesso stato che il blocco movimento/attackLock
    // qui sotto assegna quando il giocatore e' fermo e non sta colpendo --
    // un frame di ritardo (leggiamo lo stato deciso l'ultimo frame, dato
    // che ragdoll.update() gira PRIMA di quel blocco) e' impercettibile e
    // lo stesso pattern che CombatSoldier.tsx usa per l'IA.
    ragdoll.update(
      delta,
      useStore.getState().euphoriaRagdollEnabled && !inCarBody(),
      data.state === 'In guardia' || data.state === 'Riposo',
      useStore.getState().ragdollPassive
    );
    // di nuovo DOPO il ragdoll attivo: le braccia fisiche non sempre
    // riescono a seguire la posa (limiti dei giunti, inerzia) e il fucile
    // e' rigido sul petto -- le mani restano comunque sull'arma
    rifleIK();
    hangIK();
    // Keeps `data.hurtboxHandle` current for whoever's attacking THIS
    // fighter (their own checkAttackContact reads it off `opponent`) --
    // see FighterData's comment.
    data.hurtboxHandle = ragdoll.getHurtboxHandle();

    // Banco di prova: in T-pose o con un'animazione di prova il
    // personaggio sta fermo sul posto, niente macchina a stati/input.
    if (tPoseBench || benchClip) return;

    if (!groupRef.current) return;

    const groundBase = (x: number, z: number) => getTerrainHeight(x, z) + getRoadOffset(x, z);
    // Quota: la decide traversal.ts (piedi a terra, sui blocchi, in aria,
    // appesi...); data.position.y resta "sopra il terreno" come prima.
    const applyTransform = () => {
      const tr = travRef.current;
      if (data.isDead || kd.isDown()) {
        // a terra per fisica: finito il KO si riparte da terra (followGround
        // riporta i piedi sull'appoggio del punto in cui ci si rialza)
        if (tr.mode !== 'ground') {
          tr.mode = 'ground';
          tr.vy = 0;
          tr.ledge = null;
          tr.ladder = null;
        }
      } else {
        followGround(tr, { world, rapier, pos: data.position, baseY: groundBase });
      }
      const groundY = groundBase(data.position.x, data.position.z);
      data.position.y = tr.feetY - groundY;
      // (rialzo da terra: il modello parte alzato, vedi useKnockdown)
      groupRef.current!.position.set(data.position.x, tr.feetY + getUpLift(), data.position.z);
      // tutta la rotazione, non solo .y: in auto il gruppo prende il
      // quaternione del sedile, e per un'imbardata oltre i 90 gradi three la
      // scompone in Euler XYZ come (±PI, PI - imbardata, ±PI). Scesi
      // dall'auto x e z restavano a ±PI e ".y = data.rotation" girava il
      // personaggio a specchio: guardava da una parte e camminava
      // dall'altra (misurato: rotazione del gruppo (-PI, 1.72, -PI)).
      groupRef.current!.rotation.set(0, data.rotation, 0);
    };

    // "nn voglio che usi distanze per fermarlo.. ogni parte del corpo
    // deve essere un collider.. se collide collide.. se sbatto col sacco
    // dovrei muoverlo" -- routes ANY horizontal movement this fighter
    // wants to make (walking, sprinting, dodging -- both call sites
    // below) through the real per-limb collision resolution instead of
    // applying it to data.position directly. onBagBump forwards a real
    // Rapier contact (not a scripted animation) straight into
    // PunchingBag.tsx's own applyBodyBump the instant any of this
    // fighter's 11 solid colliders is the one that actually touched it.
    const resolveAndApplyMovement = (desiredX: number, desiredZ: number) => {
      const corrected = ragdoll.resolveBodyMovement(
        desiredX,
        desiredZ,
        bagSolidHandle ?? null,
        bagRef?.current ? (point, dir, blocked) => bagRef.current!.applyBodyBump(point, dir, blocked) : undefined
      );
      data.position.x += corrected.x;
      data.position.z += corrected.z;
      if (import.meta.env.DEV) {
        // misura: quanto movimento viene chiesto e quanto ne resta dopo le
        // collisioni del corpo solido (per il controllo di camminata/corsa)
        const m = ((window as any).__moveDebug ??= { want: 0, got: 0, frames: 0, blocked: 0 });
        const w = Math.hypot(desiredX, desiredZ),
          g = Math.hypot(corrected.x, corrected.z);
        m.want += w;
        m.got += g;
        m.frames++;
        if (g < w * 0.98) m.blocked++;
      }
    };

    // --- Auto: "dobbiamo insegnare al personaggio ad entrarci e guidarla".
    // F vicino alla portiera del guidatore: va alla portiera, la apre, si
    // siede (Sitting_Enter) e prende il volante (Driving, controllo
    // all'auto); F guidando (piano): scende dalla stessa parte (Sitting_Exit).
    // Posizioni dai nodi del modello dell'auto (seat_1 / entrance_1 /
    // door_1), come fa il personaggio del playground (Player.tsx).
    {
      const vs = vehRef.current;
      const st = useStore.getState();
      const dtV = delta * globalSpeed;
      const carParts = (id: string | null) => {
        if (!id) return null;
        const root = threeScene.getObjectByName(id);
        const seat = root?.getObjectByName('seat_1');
        const entrance = root?.getObjectByName('entrance_1');
        if (!root || !seat || !entrance) return null;
        return { root, seat, entrance };
      };
      // radice del personaggio seduto al posto di guida + orientamento del gruppo
      const seatPose = (parts: NonNullable<ReturnType<typeof carParts>>, outPos: THREE.Vector3, outQuat: THREE.Quaternion) => {
        parts.root.getWorldQuaternion(_carQuat);
        parts.seat.getWorldPosition(outPos);
        _carFwd.set(0, 0, 1).applyQuaternion(_carQuat);
        _carUp.set(0, 1, 0).applyQuaternion(_carQuat);
        const off = VEH_SEAT[vs.kind];
        outPos.addScaledVector(_carFwd, off.fwd).addScaledVector(_carUp, -off.down);
        // il gruppo del personaggio guarda verso il suo -Z locale (vedi la
        // rotazione di PI del modello): auto * giro di 180 gradi
        outQuat.copy(_carQuat).multiply(_yawPi);
      };
      const entrancePose = (parts: NonNullable<ReturnType<typeof carParts>>, outPos: THREE.Vector3, outQuat: THREE.Quaternion) => {
        parts.root.getWorldQuaternion(_carQuat);
        parts.entrance.getWorldPosition(outPos);
        outPos.y = groundBase(outPos.x, outPos.z);
        // in piedi alla portiera, rivolto verso l'auto (verso il sedile)
        parts.seat.getWorldPosition(_carTmp);
        const fx = _carTmp.x - outPos.x,
          fz = _carTmp.z - outPos.z;
        outQuat.setFromAxisAngle(_worldUp, Math.atan2(-fx, -fz));
      };
      const setGroupPose = (pos: THREE.Vector3, quat: THREE.Quaternion) => {
        groupRef.current!.position.copy(pos);
        groupRef.current!.quaternion.copy(quat);
        data.position.x = pos.x;
        data.position.z = pos.z;
        data.rotation = _carEuler.setFromQuaternion(quat, 'YXZ').y;
      };

      if (vs.mode === 'none') {
        // F a piedi, fermi e liberi: auto vicina?
        const fPressed = input.consumeJustPressed('enter');
        const vehIds = typeof vehicleIds === 'function' ? vehicleIds() : vehicleIds;
        if (fPressed && vehIds?.length && !data.isDead && !kd.isDown() && !traving() && data.attackLock <= 0) {
          for (const id of vehIds) {
            const parts = carParts(id);
            if (!parts) continue;
            parts.entrance.getWorldPosition(_carTmp);
            if (Math.hypot(_carTmp.x - data.position.x, _carTmp.z - data.position.z) < CAR_ENTER_RANGE) {
              vs.mode = 'toDoor';
              vs.carId = id;
              vs.kind = st.entities.get(id)?.type === 'helicopter' ? 'helicopter' : 'car';
              vs.t = 0;
              data.state = "Va all'auto";
              break;
            }
          }
        }
      }

      if (vs.mode !== 'none') {
        const parts = carParts(vs.carId);
        if (!parts) {
          vs.mode = 'none';
        } else {
          vs.t += dtV;
          if (vs.mode === 'toDoor') {
            // cammina fino alla portiera (ultimi 2.5 m: niente giro attorno all'auto)
            entrancePose(parts, _carTmp2, _carQ2);
            const dx = _carTmp2.x - data.position.x,
              dz = _carTmp2.z - data.position.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.06 || vs.t > 4) {
              vs.mode = 'opening';
              vs.t = 0;
              transitionToAnimation('Interact', 0.2, false, 1.3, 0.35);
            } else {
              const step = Math.min(d, LT.walkSpeed * dtV);
              data.position.x += (dx / d) * step;
              data.position.z += (dz / d) * step;
              let a = Math.atan2(-dx, -dz) - data.rotation;
              a = Math.atan2(Math.sin(a), Math.cos(a));
              data.rotation += a * Math.min(1, 10 * dtV);
              transitionToAnimation(animCatalog.walk, 0.15, true, timeScaleFor(animCatalog.walk, LT.walkSpeed));
              applyTransform();
            }
            if (vs.mode === 'toDoor') return;
          }
          if (vs.mode === 'opening') {
            // si gira verso l'auto e tira la maniglia; la portiera si apre a 0.3 s
            entrancePose(parts, _carTmp2, _carQ2);
            _carQ3.setFromAxisAngle(_worldUp, data.rotation).slerp(_carQ2, Math.min(1, 8 * dtV));
            data.rotation = _carEuler.setFromQuaternion(_carQ3, 'YXZ').y;
            data.position.x = _carTmp2.x;
            data.position.z = _carTmp2.z;
            if (vs.t > 0.3 && !st.isVehicleTransitioning) st.setIsVehicleTransitioning(true, vs.carId, VEH_DOOR[vs.kind]);
            applyTransform();
            if (vs.t >= CAR_OPEN_S) {
              vs.mode = 'entering';
              vs.t = 0;
              vs.from.set(data.position.x, travRef.current.feetY, data.position.z);
              vs.fromQuat.setFromAxisAngle(_worldUp, data.rotation);
              transitionToAnimation('Sitting_Enter', 0.2, false, 1.62 / CAR_ENTER_S);
            }
            return;
          }
          if (vs.mode === 'entering' || vs.mode === 'exiting') {
            const dur = vs.mode === 'entering' ? CAR_ENTER_S : CAR_EXIT_S;
            const f = Math.min(1, vs.t / dur);
            const e = -(Math.cos(Math.PI * f) - 1) / 2; // easeInOutSine, come il playground
            if (vs.mode === 'entering') seatPose(parts, _carTmp2, _carQ2);
            else entrancePose(parts, _carTmp2, _carQ2);
            _carTmp.lerpVectors(vs.from, _carTmp2, e);
            _carQ3.slerpQuaternions(vs.fromQuat, _carQ2, e);
            setGroupPose(_carTmp, _carQ3);
            if (f >= 1) {
              if (vs.mode === 'entering') {
                vs.mode = 'driving';
                st.setIsVehicleTransitioning(false);
                st.setCurrentControllable(vs.kind, vs.carId, 'driver', 'seat_1');
                transitionToAnimation('Driving', 0.2, true);
                data.state = 'Guida';
              } else {
                vs.mode = 'none';
                st.setIsVehicleTransitioning(false);
                st.setCurrentControllable(footControllable, entityName);
                groupRef.current!.rotation.set(0, data.rotation, 0);
                const tr = travRef.current;
                tr.mode = 'ground';
                tr.feetY = _carTmp2.y;
                tr.vy = 0;
                tr.lastX = data.position.x;
                tr.lastZ = data.position.z;
                data.state = idleState();
                transitionToAnimation(idleName(), 0.25, true);
                vs.carId = null;
              }
            }
            return;
          }
          if (vs.mode === 'driving') {
            if (publishPlayerInfo) st.setIsPlayerGrounded(true);
            seatPose(parts, _carTmp2, _carQ2);
            setGroupPose(_carTmp2, _carQ2);
            transitionToAnimation('Driving', 0.2, true);
            parts.root.getWorldPosition(_carTmp);
            if (dtV > 1e-4 && vs.t > dtV * 1.5) {
              const sp = Math.hypot(_carTmp.x - vs.carPrev.x, _carTmp.z - vs.carPrev.z) / dtV;
              vs.carSpeed += (sp - vs.carSpeed) * Math.min(1, 10 * dtV);
            }
            vs.carPrev.copy(_carTmp);
            // F: scende (solo a bassa velocita')
            if (input.consumeJustPressed('enter')) {
              // elicottero: solo posato (o quasi) -- in volo non si scende
              const lowEnough =
                vs.kind !== 'helicopter' ||
                (parts.entrance.getWorldPosition(_carTmp), _carTmp.y - groundBase(_carTmp.x, _carTmp.z) < HELI_EXIT_MAX_HEIGHT);
              if (vs.carSpeed < CAR_EXIT_MAX_SPEED && lowEnough) {
                vs.mode = 'exiting';
                vs.t = 0;
                vs.from.copy(_carTmp2);
                vs.fromQuat.copy(_carQ2);
                st.setIsVehicleTransitioning(true, vs.carId, VEH_DOOR[vs.kind]);
                transitionToAnimation('Sitting_Exit', 0.2, false, 1.29 / CAR_EXIT_S);
                data.state = "Scende dall'auto";
              }
            }
            return;
          }
        }
      }
    }

    // Controllo altrove (drone): il corpo resta dov'e', in idle, niente input.
    // Il B che RIDA' il controllo arriva a Drone.tsx; qui si scarica soltanto,
    // altrimenti al frame dopo verrebbe letto come un nuovo "vai al drone".
    {
      const st = useStore.getState();
      if (vehRef.current.mode === 'none' && st.currentControllable !== footControllable) {
        input.consumeJustPressed('fly');
        input.consumeJustPressed('enter');
        input.consumeJustPressed('jump');
        input.consumeJustPressed('dodge');
        input.consumeJustPressed('primary');
        // R/F volano il drone (su/giu'): niente ricarica al ritorno a piedi
        input.consumeJustPressed('reload');
        input.consumeJustPressed('respawn');
        // in volo col drone: niente "a terra" (fari missione, collezionabili)
        if (publishPlayerInfo) st.setIsPlayerGrounded(false);
        if (!data.isDead && !kd.isDown() && data.attackLock <= 0 && !traving()) {
          transitionToAnimation(idleName(), 0.25, true);
          data.state = idleState();
        }
        applyTransform();
        return;
      }
      if (publishPlayerInfo && vehRef.current.mode === 'none') {
        // "a terra" per il resto del gioco (fari delle missioni,
        // collezionabili): lo pubblicava Player.tsx del boxman
        const tm = travRef.current.mode;
        st.setIsPlayerGrounded(!data.isDead && (tm === 'ground' || tm === 'land' || tm === 'bigLand' || tm === 'roll'));
        // il gruppo guarda verso il suo -Z (modello girato di PI): per lo
        // store "yaw" e' la direzione di +Z avanti, come boxman e auto
        const yaw = data.rotation + Math.PI;
        // quota: come il boxman (centro del corpo 0.5 m sopra i piedi) -- i
        // nemici misurano la distanza e mirano da li'
        st.setPlayerInfo(
          [data.position.x, travRef.current.feetY + PLAYER_INFO_Y, data.position.z],
          Math.atan2(Math.sin(yaw), Math.cos(yaw))
        );
      }
      if (droneId && vehRef.current.mode === 'none' && input.consumeJustPressed('fly') && !data.isDead && !kd.isDown() && !traving()) {
        st.setIsDrone(true);
        st.setCurrentControllable('drone', droneId);
      }
    }

    // "punto 1: ragdoll passivo alla morte" -- identical treatment to
    // CombatSoldier.tsx's own dead branch: once dead, physics drives the
    // skeleton forever and every input below is ignored.
    if (data.isDead) {
      if (data.currentAnim !== animCatalog.death) {
        transitionToAnimation(animCatalog.death, 0.2, false);
        data.state = 'K.O.';
        deadForRef.current = 0;
      }
      ragdoll.activateDeath();
      // "nn voglio vittoria o sconfitta.. continuo a giocare": dopo qualche
      // secondo a terra ci si rialza da dove si e' caduti, con la vita piena
      deadForRef.current += delta * globalSpeed;
      if (deadForRef.current >= PLAYER_REVIVE_S) {
        const place = kd.placeFromLying(travRef.current.feetY);
        data.isDead = false;
        data.hp = maxHpRef.current;
        data.triggerHit = null;
        ragdoll.deactivate();
        if (place) {
          data.position.x = place.x;
          data.position.z = place.z;
          data.rotation = place.rotation;
          // senza dissolvenza: la clip parte gia' sdraiata sul corpo a terra,
          // una dissolvenza dall'Idle in piedi trascinava i bersagli del
          // ragdoll su e giu' (vedi useRagdollActive, WAKE_NO_FEEDFORWARD_S)
          data.attackLock = transitionToAnimation(GETUP_CLIP, 0, false);
          data.state = 'Si rialza';
        } else {
          data.attackLock = 0;
          data.state = idleState();
          transitionToAnimation(idleName(), 0.2, true);
        }
      }
      applyTransform();
      return;
    }
    // (niente piu' "Vittoria!" quando i nemici sono tutti a terra: si
    // continua a giocare, se ne possono aggiungere altri)

    // A terra dopo un colpo forte: niente comandi, il corpo e' fisica pura;
    // quando si e' fermato (e girato sulla schiena) si rialza da dov'e'.
    if (data.knockdown) {
      const kdData = data.knockdown as any;
      startKnockdown(kdData.dirX, kdData.dirZ, kdData.speed);
      data.knockdown = null;
    }
    if (kd.isDown()) {
      data.triggerHit = null;
      const res = kd.step(delta * globalSpeed, travRef.current.feetY);
      if (ragdoll.getBoneWorldPosition('pelvis', _focus)) {
        data.position.x = _focus.x;
        data.position.z = _focus.z;
      }
      if (import.meta.env.DEV && res.done) {
        const ly = ragdoll.getLyingState();
        (window as any).__kdDebug = {
          t: kd.runtime().t,
          rolls: kd.runtime().rolls,
          place: res.place,
          lyPelvis: ly?.pelvis.toArray(),
          lyHead: ly?.headDir.toArray(),
          faceUp: ly?.faceUp,
          rootBefore: [data.position.x, data.position.z],
          pose: kd.lyingPose,
        };
      }
      if (res.done) {
        const place = res.place;
        if (place) {
          // (l'alzata iniziale del modello la calcola useKnockdown)
          data.position.x = place.x;
          data.position.z = place.z;
          data.rotation = place.rotation;
          // senza dissolvenza: la clip parte gia' sdraiata sul corpo a terra,
          // una dissolvenza dall'Idle in piedi trascinava i bersagli del
          // ragdoll su e giu' (vedi useRagdollActive, WAKE_NO_FEEDFORWARD_S)
          data.attackLock = transitionToAnimation(GETUP_CLIP, 0, false);
          data.state = 'Si rialza';
        } else {
          data.state = idleState();
        }
      }
      applyTransform();
      return;
    }

    // Ostacoli dell'arena (pendoli, pale, pistoni): esce da eventuali
    // compenetrazioni e, se l'ostacolo si muove, viene spinto e colpito.
    // (non mentre si e' appesi / si scavalca / si sale una scala)
    if (!traving() || travRef.current.mode === 'air' || travRef.current.mode === 'land' || travRef.current.mode === 'roll') {
      const dtO = delta * globalSpeed;
      const ob = ragdoll.resolveObstacleContacts(bagSolidHandle ?? null, dtO);
      data.position.x += ob.pushX;
      data.position.z += ob.pushZ;
      if (obstacleHitCooldownRef.current > 0) obstacleHitCooldownRef.current -= dtO;
      if (ob.hitSpeed >= OBSTACLE_KNOCKDOWN_SPEED && data.state !== 'Si rialza') {
        // fino a 11 m/s: la punta del rotore va a ~14, un tetto basso
        // lasciava il corpo cadere quasi sul posto
        startKnockdown(ob.hitVX, ob.hitVZ, Math.min(ob.hitSpeed, 11));
        // finito il frame qui: prima proseguiva e la camminata/idle sotto
        // riscriveva stato e animazione ("Riposo" mentre si vola a terra)
        if (kd.isDown()) {
          applyTransform();
          return;
        }
      } else if (ob.hitSpeed > OBSTACLE_HIT_MIN_SPEED) {
        // la spinta segue l'ostacolo (tetto per non volare via)
        const k = Math.min(1, OBSTACLE_KNOCK_MAX_SPEED / ob.hitSpeed);
        knockVelRef.current.set(ob.hitVX * k, 0, ob.hitVZ * k);
        if (obstacleHitCooldownRef.current <= 0) {
          obstacleHitCooldownRef.current = OBSTACLE_HIT_COOLDOWN_S;
          _hitImpulseDir.set(ob.hitVX, 0.25 * ob.hitSpeed, ob.hitVZ).normalize();
          ragdoll.pulseHit(
            _hitImpulseDir,
            THREE.MathUtils.clamp(ob.hitSpeed / 8, 0.25, 0.8),
            ob.segment ?? 'Torso',
            ob.hitX - _hitImpulseDir.x,
            ob.hitZ - _hitImpulseDir.z
          );
          if (data.attackLock <= 0 && !isDodgingRef.current) {
            data.attackLock = HIT_STAGGER_DURATION;
            data.state = 'Colpito!';
          }
        }
      }
      const kv = knockVelRef.current;
      if (kv.lengthSq() > 0.0025) {
        resolveAndApplyMovement(kv.x * dtO, kv.z * dtO);
        kv.multiplyScalar(Math.exp(-OBSTACLE_KNOCK_DECAY * dtO));
      } else kv.set(0, 0, 0);
    }

    if (data.triggerHit) {
      // No longer switches to the Hit_Chest/Hit_Head animation clip -- see
      // HIT_STAGGER_DURATION's comment above. The fighter keeps whatever
      // animation was already playing; only the brief action-lock and the
      // ragdoll's own physical pulse represent "being hit" now.
      data.attackLock = HIT_STAGGER_DURATION;
      data.state = 'Colpito!';
      data.triggerHit = null;
      // "fai che gli attacchi sembrino veri" -- a real physical impulse at
      // the moment of impact, not just a hit-reaction animation. Same
      // hit-pulse technique as CombatSoldier.tsx -- see useRagdoll.ts.
      _hitImpulseDir.set(Math.sin(data.rotation), 0.35, Math.cos(data.rotation));
      ragdoll.pulseHit(_hitImpulseDir, 0.3, Math.random() > 0.5 ? 'Head' : 'Torso', data.hitFromX, data.hitFromZ);
    }

    // --- Salto e arrampicata (Spazio): salto normale, scavalca i blocchi
    // bassi, si aggrappa ai bordi alti, sale le scale (traversal.ts).
    {
      camera.getWorldDirection(_tFwd);
      _tFwd.y = 0;
      _tFwd.normalize();
      _tRight.crossVectors(_tFwd, _worldUp).normalize();
      _tMove.set(0, 0, 0);
      if (input.forward) _tMove.add(_tFwd);
      if (input.backward) _tMove.addScaledVector(_tFwd, -1);
      if (input.left) _tMove.addScaledVector(_tRight, -1);
      if (input.right) _tMove.add(_tRight);
      if (_tMove.lengthSq() > 0.0001) _tMove.normalize();
      const ctx: TravCtx = {
        world,
        rapier,
        dt: delta * globalSpeed,
        pos: data.position,
        rotation: data.rotation,
        setRotation: (r: number) => {
          data.rotation = r;
          ctx.rotation = r;
        },
        baseY: groundBase,
        play: (clip, fade, loop, ts = 1, startAt = 0) => {
          transitionToAnimation(clip, fade, loop, ts, startAt);
          // la posa di caduta e' un frammento di 0.29 s: avanti e indietro
          // (ping-pong) e lenta, cosi' "si agita" senza scatti di ripartenza
          if (clip === 'Fall_Air__ip' && actions[clip]) actions[clip].setLoop(THREE.LoopPingPong, Infinity);
        },
        resolveMove: (dx, dz) => resolveAndApplyMovement(dx, dz),
        input: {
          forward: !!input.forward,
          backward: !!input.backward,
          jumpPressed: input.consumeJustPressed('jump'),
          move: _tMove,
          moveSpeed: input.shift && !aimingRef.current ? LT.runSpeed : LT.walkSpeed,
        },
        canAct: data.attackLock <= 0 && data.state !== 'Si rialza' && !isDodgingRef.current,
      };
      if (stepTraversal(travRef.current, ctx)) {
        const m = travRef.current.mode;
        data.state =
          m === 'air'
            ? 'In aria'
            : m === 'hang'
              ? 'Appeso'
              : m === 'ladder'
                ? 'Sulla scala'
                : m === 'land' || m === 'bigLand'
                  ? 'Atterra'
                  : m === 'roll'
                    ? 'Capriola'
                    : 'Arrampica';
        applyTransform();
        return;
      }
    }

    if (data.attackLock > 0) {
      data.attackLock -= delta * globalSpeed;
      // Only a dodge roll actually covers ground while locked -- an
      // attack swing or a hit-stun both stay planted in place, same as
      // CombatSoldier.tsx.
      if (isDodgingRef.current) {
        resolveAndApplyMovement(
          dodgeDirRef.current.x * DODGE_SPEED * delta * globalSpeed,
          dodgeDirRef.current.z * DODGE_SPEED * delta * globalSpeed
        );
      }
      if (isAttackingRef.current && knifeLungeLeftRef.current > 0) {
        const dt = Math.min(knifeLungeLeftRef.current, delta * globalSpeed);
        knifeLungeLeftRef.current -= dt;
        resolveAndApplyMovement(-Math.sin(data.rotation) * KNIFE_LUNGE_SPEED * dt, -Math.cos(data.rotation) * KNIFE_LUNGE_SPEED * dt);
      }
      // "il colpo deve essere sferrato dove effettivamente le mesh
      // collidono" -- while THIS swing is still live and hasn't already
      // connected, check every frame instead of once at the moment the
      // button was pressed (see checkAttackContact above).
      if (isAttackingRef.current && !attackHasLandedRef.current && checkAttackContact()) {
        attackHasLandedRef.current = true;
      }
      if (data.attackLock <= 0) {
        // Rete di sicurezza: una mano ancora DENTRO il bersaglio quando
        // l'animazione dello swing stesso finisce (nessun frame "appena
        // uscita" naturale a far scattare finalizePendingHit sopra) deve
        // comunque risolversi -- attackLock esaurito e' un segnale di
        // "fine swing" chiaro quanto l'uscita dal volume.
        if (isAttackingRef.current && !attackHasLandedRef.current && pendingHitRef.current) {
          if (finalizePendingHit()) attackHasLandedRef.current = true;
        }
        transitionToAnimation(idleName(), 0.2, true);
        data.state = idleState();
        isDodgingRef.current = false;
        isAttackingRef.current = false;
      }
      applyTransform();
      return;
    }

    if (dodgeLockRef.current > 0) dodgeLockRef.current -= delta * globalSpeed;

    // Camera-relative movement axes -- computed FIRST now (used to be
    // after the facing block below), since the facing decision itself
    // now needs to know _moveDir when not locked on -- see below. Same
    // technique Player.tsx's own on-foot movement uses (state.camera.
    // getWorldDirection() projected flat).
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    _right.crossVectors(_forward, _worldUp).normalize();

    _moveDir.set(0, 0, 0);
    if (input.forward) _moveDir.add(_forward);
    if (input.backward) _moveDir.addScaledVector(_forward, -1);
    if (input.left) _moveDir.addScaledVector(_right, -1);
    if (input.right) _moveDir.add(_right);

    // _toOpponent -- needed both by the lock-on facing below and the
    // dodge block's own "no direction held" fallback further down.
    // Con piu' nemici: il piu' vicino ancora vivo; con nessuno resta
    // nullo (il lock-on non fa niente, la schivata va all'indietro).
    _toOpponent.set(0, 0, 0);
    {
      let bestD = Infinity;
      for (const o of opponents) {
        if (o.isDead) continue;
        const d = data.position.distanceToSquared(o.position);
        if (d < bestD) {
          bestD = d;
          _toOpponent.subVectors(o.position, data.position);
        }
      }
    }
    _toOpponent.y = 0;
    if (_toOpponent.lengthSq() > 0.0001) _toOpponent.normalize();

    // Facing: "guardare l'avversario se tengo premuto l1. si accancia
    // all'avversario piu' vicino" -- lock-on is now a HELD modifier
    // (input.lockOn, L1/Ctrl sinistro) rather than always-on. Holding it
    // snap-turns the legs toward the opponent (the only target this
    // component ever has -- see PlayerCombatSoldierProps' own
    // `opponent`); releasing it, the legs instead face wherever you're
    // actually walking (same free-roam convention Player.tsx's own
    // on-foot movement uses), or simply keep their current heading while
    // standing still. Aiming punches stays entirely the torso's job
    // either way (the camYaw/yawDiff block up top, unaffected by this).
    // (la locomozione libera gira il corpo per conto suo, vedi sotto)
    const rotBeforeFacing = data.rotation;
    let targetRotation: number | null = null;
    if (isGun()) {
      // Con la pistola il corpo guarda sempre dove guarda la camera
      // (terza persona sopra la spalla): si cammina/strafa mirando.
      targetRotation = camYaw;
    } else if (input.lockOn && _toOpponent.lengthSq() > 0.0001) {
      targetRotation = Math.atan2(_toOpponent.x, _toOpponent.z) + Math.PI;
    } else if (_moveDir.lengthSq() > 0.0001) {
      targetRotation = Math.atan2(_moveDir.x, _moveDir.z) + Math.PI;
    }
    if (targetRotation !== null) {
      let angleDiff = targetRotation - data.rotation;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      data.rotation += angleDiff * (isGun() ? PISTOL_FACE_TURN_RATE : FACE_TURN_RATE);
    }

    // --- Block (held) --- (solo a mani nude: con la pistola il tasto
    // destro e' la mira)
    // (input.attackLeft: L2 a mani nude e' il pugno sinistro, non la parata)
    if ((weaponRef.current === 'fists' || weaponRef.current === 'knife') && input.secondary && !input.attackLeft) {
      data.state = 'Parata';
      transitionToAnimation(animCatalog.block, 0.15, true);
      applyTransform();
      return;
    }

    // --- Dodge (tap Space) -- moved off Shift, which is also "hold to
    // sprint": sharing the key meant every sprint tap also fired a dodge.
    // (Spazio adesso e' il salto, vedi traversal.ts: la capriola va su V / L3)
    if (input.consumeJustPressed('dodge') && dodgeLockRef.current <= 0) {
      data.state = 'Capriola';
      if (_moveDir.lengthSq() > 0.0001) {
        dodgeDirRef.current.copy(_moveDir).normalize();
      } else {
        // No direction held -- fall back to the old "away from the
        // opponent" hop. _toOpponent is still valid from the facing
        // update just above.
        if (_toOpponent.lengthSq() > 0.0001) {
          dodgeDirRef.current.copy(_toOpponent).multiplyScalar(-1);
        } else {
          // nessun nemico: indietro rispetto a dove guarda il personaggio
          dodgeDirRef.current.set(Math.sin(data.rotation), 0, Math.cos(data.rotation));
        }
      }
      isDodgingRef.current = true;
      data.attackLock = transitionToAnimation(animCatalog.dodge, 0.1, false);
      dodgeLockRef.current = data.attackLock + DODGE_EXTRA_LOCK;
      applyTransform();
      return;
    }

    // --- Pistola: mira (tasto destro), sparo (sinistro), ricarica (R),
    // movimento con strafe. Le gambe usano le clip __legs, il busto il
    // layer alto (updateUpperLayer).
    if (isGun()) {
      const wantReload = input.consumeJustPressed('reload') || input.consumeJustPressed('respawn');
      if (wantReload) startReload();
      aimingRef.current = !!input.secondary && reloadLeftRef.current <= 0;
      // pistola: un colpo per pressione; fucile: automatico finche' tieni premuto
      const pressed = input.consumeJustPressed('primary');
      const wantFire = GUN_STATS[gunKind()].auto ? pressed || !!input.primary : pressed;
      if (wantFire && !wheelOpen && reloadLeftRef.current <= 0 && fireCooldownRef.current <= 0) {
        fire();
      }
      // i pugni non partono con la pistola in mano
      input.consumeJustPressed('yawLeft');
      input.consumeJustPressed('attackLeft');
      input.consumeJustPressed('yawRight');

      if (_moveDir.lengthSq() > 0.0001) {
        _moveDir.normalize();
        const sprint = input.shift && !aimingRef.current && reloadLeftRef.current <= 0;
        const loco = pickDirectionalLoco(sprint, aimingRef.current ? aimWalkTs() : dirWalkTs(), '__legs');
        resolveAndApplyMovement(_moveDir.x * loco.speed * delta * globalSpeed, _moveDir.z * loco.speed * delta * globalSpeed);
        transitionToAnimation(loco.clip, 0.2, true, loco.ts);
        data.state = loco.running ? 'Corre' : 'Si muove';
      } else {
        transitionToAnimation(idleName(), 0.2, true);
        data.state = idleState();
      }
      applyTransform();
      return;
    }

    // --- Attacks: three distinct strikes, one per key, instead of one
    // button randomly drawing from a pool -- "dividi i colpi in piu tasti
    // cosi riesco a sceglierli". All three share the exact same
    // resolution machinery (attackLock/checkAttackContact, run every
    // frame from the attackLock branch above -- it doesn't care which
    // clip is playing), so they're only distinguished by which action
    // fired and which catalog clip it plays.
    //
    // "con l2 usa il braccio sinistro e con r2 quello destro.. mi pare
    // che le animazioni lo permettano" -- verified empirically rather
    // than guessed from clip names alone (this session already learned
    // that lesson on the ragdoll's own bone axes): parsed both animation
    // GLBs' actual rotation keyframes and measured how much each arm's
    // bones (lowerarm_l/r, upperarm_l/r) move during each clip.
    // Punch_Jab turned out to be almost entirely a LEFT-arm swing
    // (lowerarm_l ~255deg of motion vs lowerarm_r ~20deg) and
    // Punch_Cross almost entirely a RIGHT-arm swing (lowerarm_r ~312deg
    // vs lowerarm_l ~62deg) -- clean, single-arm clips this rig actually
    // has, confirming the "Jab"/"Cross" boxing convention (jab = lead/
    // left hand, cross = rear/right hand) really does hold here. Hook
    // (Melee_Hook) moves BOTH arms substantially, with no single
    // dominant side, so it stays on its own neutral key rather than
    // being called left or right.
    //
    // --- Coltello: fendenti alternati (click), terzo fendente (Q),
    // affondo pesante (E). Stesso sistema di contatto dei pugni, ma i punti
    // che toccano sono la punta e la meta' della lama (checkAttackContact).
    if (weaponRef.current === 'knife') {
      let clip: string | null = null;
      let dmg = KNIFE_DAMAGE_SLASH;
      if (input.consumeJustPressed('primary')) {
        clip = KNIFE_SLASH_CLIPS[knifeSlashRef.current % KNIFE_SLASH_CLIPS.length];
        knifeSlashRef.current++;
      } else if (input.consumeJustPressed('yawLeft') || input.consumeJustPressed('attackLeft')) {
        clip = KNIFE_THIRD_CLIP;
      } else if (input.consumeJustPressed('yawRight')) {
        clip = KNIFE_HEAVY_CLIP;
        dmg = KNIFE_DAMAGE_HEAVY;
      }
      if (clip) {
        if (!actions[clip]) clip = animCatalog.attackCross;
        meleeDamageRef.current = dmg;
        data.state = `Coltello (${clip})`;
        data.attackLock = transitionToAnimation(clip, 0.1, false);
        isAttackingRef.current = true;
        attackHasLandedRef.current = false;
        knife.playSwing();
        knifeLungeLeftRef.current = KNIFE_LUNGE_S;
        applyTransform();
        return;
      }
    } else {
      meleeDamageRef.current = PUNCH_DAMAGE;
    }

    // Cross (RIGHT arm) -- primary (Left Click / gamepad R2).
    if (input.consumeJustPressed('primary')) {
      data.state = `Attacco (${animCatalog.attackCross})`;
      data.attackLock = transitionToAnimation(animCatalog.attackCross, 0.1, false);
      // No longer resolved here -- ATTACK_RANGE (root-to-root, generous)
      // used to gate damage the instant the button was pressed. Now the
      // swing just starts playing, and checkAttackContact (run every
      // frame from the attackLock branch above, on THIS SAME NEW attack
      // since attackHasLandedRef resets to false here) decides whether
      // and when it actually connects. Still whiffs harmlessly if the
      // hand never gets close enough before the swing ends.
      isAttackingRef.current = true;
      attackHasLandedRef.current = false;
      applyTransform();
      return;
    }

    // Jab (LEFT arm) -- Q on keyboard, Square (X) OR L2 on gamepad.
    // Reuses the 'yawLeft' action (bound to KeyQ and gamepad Square --
    // see useInput.ts's gamepad section) plus the new 'attackLeft'
    // action (L2 only, added specifically for this) OR'd together, so
    // all three inputs throw the same left-handed punch.
    if (input.consumeJustPressed('yawLeft') || input.consumeJustPressed('attackLeft')) {
      data.state = `Attacco (${animCatalog.attackJab})`;
      data.attackLock = transitionToAnimation(animCatalog.attackJab, 0.1, false);
      isAttackingRef.current = true;
      attackHasLandedRef.current = false;
      applyTransform();
      return;
    }

    // Hook (mixed, not single-arm -- see above) -- E on keyboard,
    // Triangle on gamepad.
    if (input.consumeJustPressed('yawRight')) {
      data.state = `Attacco (${animCatalog.attackHook})`;
      data.attackLock = transitionToAnimation(animCatalog.attackHook, 0.1, false);
      isAttackingRef.current = true;
      attackHasLandedRef.current = false;
      applyTransform();
      return;
    }

    // --- Movement: camera-relative, same technique Player.tsx uses --
    // _forward/_right/_moveDir were already computed above (the dodge
    // block needs them too).
    const hasDir = _moveDir.lengthSq() > 0.0001;
    if (hasDir) _moveDir.normalize();
    if (input.lockOn && _toOpponent.lengthSq() > 0.0001) {
      // col lock-on (Ctrl) si guarda il nemico e le gambe usano la clip
      // della direzione (indietro / di lato): movimento da combattimento,
      // diretto, come prima
      locoRef.current.speed = 0;
      if (hasDir) {
        const loco = pickDirectionalLoco(input.shift, dirWalkTs(), '');
        resolveAndApplyMovement(_moveDir.x * loco.speed * delta * globalSpeed, _moveDir.z * loco.speed * delta * globalSpeed);
        data.state = loco.running ? 'Corre' : 'Si muove';
        transitionToAnimation(loco.clip, 0.15, true, loco.ts);
      } else {
        data.state = idleState();
        if (!kimodoIdle(delta * globalSpeed)) transitionToAnimation(idleName(), 0.2, true);
      }
      applyTransform();
      return;
    }

    // Movimento libero alla GTA IV (gtaLocomotion.ts): inerzia, curve a
    // velocita' angolare limitata, si va dove si guarda.
    const dtL = delta * globalSpeed;
    const ls = locoRef.current;
    const injured = data.hp < maxHpRef.current * INJURED_HP && !!actions[K.injuredWalk];
    const walkClip = injured ? K.injuredWalk : animCatalog.walk;
    const walkSpeed = injured ? INJURED_WALK_SPEED : LT.walkSpeed;
    const runClip = injured ? walkClip : animCatalog.run;
    // "deve salire e scendere un gradino alla volta come un vero umano": sulle
    // scale la camminata (o la corsa) gira alla sua cadenza normale ma ogni
    // passo avanza di una pedata, quindi si va piu' piano (velocita' =
    // cadenza x 2 pedate a ciclo); footIK accorcia il passo animato e mette
    // ogni piede al centro della pedata dopo quella dell'altro.
    const dW = clipsMap[walkClip]?.duration ?? 1;
    const dR = clipsMap[runClip]?.duration ?? 1;
    const gW = CLIP_GROUND_SPEED[walkClip] ?? walkSpeed / Math.max(0.1, timeScaleFor(walkClip, walkSpeed));
    const gR = CLIP_GROUND_SPEED[runClip] ?? gW;
    const stair = stepAt(data.position.x, data.position.z, travRef.current.feetY);
    const stairCycle = stair ? 2 * stair.tread : 0;
    const runWanted = input.shift && !injured;
    const want = !hasDir
      ? 0
      : stair
        ? (runWanted ? LT.runSpeed / (gR * dR) : walkSpeed / (gW * dW)) * stairCycle
        : runWanted
          ? LT.runSpeed
          : walkSpeed;
    data.rotation = stepLoco(ls, rotBeforeFacing, hasDir ? Math.atan2(_moveDir.x, _moveDir.z) + Math.PI : null, want, LT.runSpeed, dtL);
    const running = ls.speed > (walkSpeed + LT.runSpeed) / 2;
    // fiatone: secondi di corsa di fila (camminare li fa calare piano)
    if (running) sprintTimeRef.current += dtL;
    else sprintTimeRef.current = Math.max(0, sprintTimeRef.current - dtL * 0.5);

    if (ls.speed > 0.02 || hasDir) {
      breathLeftRef.current = 0;
      celebrateRef.current = { delay: 0, left: 0 };
      _bodyFwd.set(-Math.sin(data.rotation), 0, -Math.cos(data.rotation));
      resolveAndApplyMovement(_bodyFwd.x * ls.speed * dtL, _bodyFwd.z * ls.speed * dtL);
      data.state = ls.skidding ? 'Frena' : running ? 'Corre' : 'Si muove';

      // fermo / camminata / corsa mescolati, piedi in fase: le due clip del
      // passo vanno alla stessa fase del ciclo (appoggio sinistro allineato)
      // e la cadenza e' quella che fa avanzare i piedi alla velocita' vera
      const idleClip = idleName();
      const clips = [walkClip, runClip, idleClip].filter((c, i, arr) => !!actions[c] && arr.indexOf(c) === i);
      const lb = locoBlendRef.current;
      if (!lb.active) {
        // entrata: da quello che c'era (un colpo, un idle Kimodo...)
        const prev = actions[data.currentAnim];
        if (prev && !clips.includes(data.currentAnim)) prev.fadeOut(0.2);
        lb.active = true;
        lb.blendIn = 0;
        for (const c of clips) {
          const a = actions[c];
          a.stopFading();
          a.reset();
          a.setLoop(THREE.LoopRepeat, Infinity);
          a.setEffectiveWeight(0);
          a.play();
        }
      }
      // una clip che esce dal mescolamento (il riposo cambia salendo su una
      // scala) si dissolve, se no resterebbe al peso che aveva
      for (const c of lb.clips) if (!clips.includes(c)) actions[c]?.fadeOut(0.25);
      lb.clips = clips;
      lb.blendIn = Math.min(1, lb.blendIn + dtL / 0.2);
      // sulle scale si va piu' piano alla stessa cadenza: camminata o corsa le
      // decide la cadenza (cicli al secondo), non la velocita'
      let blendSpeed = ls.speed;
      if (stair) {
        const cyc = ls.speed / Math.max(0.05, stairCycle);
        const cW = walkSpeed / (gW * dW);
        const cR = LT.runSpeed / (gR * dR);
        blendSpeed = cyc <= cW ? cyc * gW * dW : walkSpeed + ((cyc - cW) / Math.max(1e-3, cR - cW)) * (LT.runSpeed - walkSpeed);
      }
      const w = locoWeights(blendSpeed, walkSpeed, LT.runSpeed);
      const wWalk = runClip === walkClip ? w.walk + w.run : w.walk;
      const wRun = runClip === walkClip ? 0 : w.run;
      const moving = wWalk + wRun;
      if (moving > 1e-3) {
        // metri per ciclo del passo mescolato (sulle scale: due pedate)
        const perCycle = (wWalk * gW * dW + wRun * gR * dR) / moving;
        const cycle = stair ? stairCycle : perCycle;
        ls.phase = (ls.phase + (ls.speed / Math.max(0.05, cycle)) * dtL) % 1;
        if (stair) {
          const sr = strideRef.current;
          sr.scale = Math.min(1, stairCycle / Math.max(0.05, perCycle));
          sr.fwdX = _bodyFwd.x;
          sr.fwdZ = _bodyFwd.z;
          sr.rootX = data.position.x;
          sr.rootZ = data.position.z;
        }
      }
      const set = (c: string, weight: number, synced: boolean) => {
        const a = actions[c];
        if (!a) return;
        if (!a.isRunning()) a.play();
        // il peso lo decide il mescolamento (via una dissolvenza rimasta da
        // quando era uscita)
        a.stopFading();
        a.setEffectiveWeight(weight * lb.blendIn);
        if (synced) {
          a.setEffectiveTimeScale(0);
          a.time = ((((ls.phase + (LEFT_CONTACT[c] ?? 0)) % 1) + 1) % 1) * (clipsMap[c]?.duration ?? 1);
        } else a.setEffectiveTimeScale(1);
      };
      if (runClip !== walkClip) set(runClip, wRun, true);
      set(walkClip, wWalk, true);
      if (idleClip !== walkClip && idleClip !== runClip) set(idleClip, w.idle, false);
      // la clip "di riferimento" (chi legge data.currentAnim)
      data.currentAnim = wRun > wWalk ? runClip : wWalk >= w.idle ? walkClip : idleClip;
      // inclinazione nelle curve (rollio del modello intorno al suo avanti)
      clone.rotation.z = -ls.lean;
    } else {
      ls.lean = 0;
      data.state = idleState();
      if (!kimodoIdle(dtL)) transitionToAnimation(idleName(), 0.2, true);
    }

    applyTransform();
  });

  // piedi sul terreno vero e fermi quando appoggiano (footIK.ts): dopo
  // tutto il resto del frame (animazione, mira, IK delle mani, posizione)
  useFrame((_state, delta) => {
    const bench = useStore.getState();
    const active =
      !bench.tPoseDebug &&
      !bench.ragdollBench.benchClip &&
      !data.isDead &&
      !isDown() &&
      !traving() &&
      !inCarBody() &&
      !isDodgingRef.current &&
      travRef.current.mode === 'ground';
    const p = groupRef.current?.position;
    applyFootIK(footIKRef.current, clone, {
      world,
      rapier,
      feetY: travRef.current.feetY,
      baseY: p ? getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z) : travRef.current.feetY,
      active,
      dt: delta * globalSpeed,
      stride: strideRef.current,
      fwdX: -Math.sin(data.rotation),
      fwdZ: -Math.cos(data.rotation),
      moving: locoRef.current.speed > 0.05,
    });
    // il passo accorciato vale solo per il frame in cui il movimento l'ha chiesto
    strideRef.current.scale = 1;
  });

  return (
    <>
      <group ref={groupRef} name={entityName}>
        <primitive object={clone} scale={1} rotation={[0, Math.PI, 0]} />
        {!data.isDead && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[0.35, 0.45, 24]} />
            <meshBasicMaterial color={PLAYER_COLOR} />
          </mesh>
        )}
      </group>
      {/* "fai riferimenti visivi per ragdoll e fisica dei solidi" -- world-
          space wireframes of the 11 real solid colliders above, NOT nested
          inside groupRef (which already has its own local transform
          applied every frame via applyTransform -- these are driven
          purely from the Rapier bodies' own live world translations, so
          nesting them under groupRef would double the transform). */}
      {/* <SolidBodyDebugView getSegments={ragdoll.getSolidBodySegments} /> */}
      {/* ruota delle armi: Tab / L1 tenuto */}
      <WeaponWheelController footControllable={footControllable} isDead={() => data.isDead} />
      {/* "impostare la vista in modo da avere dei test empirici" --
          rosso quando un giunto del layer attivo sta sforando il
          proprio cono, vedi ActiveRagdollDebugView.tsx. */}
      <ActiveRagdollDebugView getSegments={ragdoll.getActiveRagdollDebugSegments} />
    </>
  );
};

export default PlayerCombatSoldier;

useGLTF.preload(MODEL_URL);
useGLTF.preload(BASE_ANIMS_URL);
useGLTF.preload(ADDON_ANIMS_URL);
useGLTF.preload(KIMODO_ANIMS_URL);
