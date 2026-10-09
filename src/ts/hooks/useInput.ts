import { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { dronePad } from '../lib/droneFlight';
import { talkState } from '../lib/dialogue';

const STICK_DEADZONE = 0.25;
const DRONE_HOLD_MS = 500;
// azioni che restano attive col dialogo aperto (ci si puo' allontanare)
const DIALOGUE_FREE_ACTIONS = new Set<string>(['forward', 'backward', 'left', 'right', 'shift']);
const SPRINT_TAP_WINDOW_MS = 900;

const ACTION_NAMES = [
  'forward', 'backward', 'left', 'right', 'jump', 'shift',
  'yawLeft', 'yawRight', 'enter', 'enter_passenger', 'seat_switch',
  'camera', 'fly', 'respawn', 'primary', 'secondary', 'pause', 'headlights',
  // Gamepad-only for now (L2/button 6) -- "con l2 usa il braccio
  // sinistro" -- kept as its OWN action rather than folded into
  // 'yawLeft'/'shift' (L2 already drives 'shift' too, see the gamepad
  // section below) specifically so it doesn't double up with anything
  // 'shift' does elsewhere (e.g. Helicopter.tsx reads input.shift every
  // frame to ascend -- piling a second, unrelated meaning onto the same
  // held button while flying would be a real conflict, unlike the
  // edge-triggered 'enter' reuse Square/Triangle already share).
  'attackLeft',
  // "guardare l'avversario se tengo premuto l1" -- HELD lock-on
  // modifier for PlayerCombatSoldier.tsx's leg/root facing (Ctrl
  // sinistro on keyboard, L1 on gamepad -- see the gamepad section
  // below). A brand-new action, not reused from anything else, since
  // it needs to be read as a continuous held state (input.lockOn),
  // not consumeJustPressed.
  'lockOn',
  // "estrai la pistola..." -- cambio arma nel duello (1 = pugni, 2 =
  // pistola; croce direzionale sinistra/destra sul pad) e ricarica sul pad
  // (croce giu'; da tastiera la ricarica e' R, che e' gia' 'respawn' --
  // PlayerCombatSoldier.tsx legge entrambe).
  'weapon1',
  'weapon2',
  // 3 = fucile, 4 = coltello (pad: croce su, pressione levetta destra)
  'weapon3',
  'weapon4',
  'reload',
  'music',
  // play/pausa di una sola cassa: J = cassa cubi, K = cassa schermo
  'musicCubi',
  'musicSchermo',
  // capriola del duello: Spazio adesso e' il salto (PlayerCombatSoldier)
  'dodge',
  // parla con un personaggio / prendi un oggetto (Missions/StoryMission.tsx):
  // T, o Triangolo sul pad quando si e' vicini a qualcuno
  'talk',
  // copertura dietro un muro alto (PlayerCombatSoldier.tsx): Q, R1 sul pad
  // (come in GTA V; lontano da un muro restano il pugno / la parata)
  'cover',
] as const;
type Action = (typeof ACTION_NAMES)[number];

const emptyActionMap = (): Record<Action, boolean> => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  shift: false,
  yawLeft: false,
  yawRight: false,
  enter: false,
  enter_passenger: false,
  seat_switch: false,
  camera: false,
  fly: false,
  respawn: false,
  primary: false,
  secondary: false,
  pause: false,
  headlights: false,
  attackLeft: false,
  lockOn: false,
  weapon1: false,
  weapon2: false,
  weapon3: false,
  weapon4: false,
  reload: false,
  music: false,
  musicCubi: false,
  musicSchermo: false,
  dodge: false,
  talk: false,
  cover: false,
});

export const useInput = () => {
  const [input, setInput] = useState(emptyActionMap);

  // Refs are better for "just pressed" as they don't trigger re-renders
  // and are immediate for useFrame consumption.
  const justPressed = useRef<Record<string, boolean>>({});
  // "per correre devo premere x piu' volte come gta": istanti delle ultime
  // pressioni del tasto corsa (X / Shift), per sprintMash() qui sotto
  const shiftTaps = useRef<number[]>([]);
  // Select del pad: premuto = camera, tenuto DRONE_HOLD_MS = drone (prendi/lascia)
  const selectDownAt = useRef(0);
  const selectHoldFired = useRef(false);
  // Triangolo usato per lasciare il drone: non vale come "sali in auto"
  // finche' non lo si rilascia
  const triangleBlocked = useRef(false);

  // Keyboard/mouse and gamepad are two independent sources, each tracked
  // on its own and OR-ed together into `input` below. Without this split,
  // polling the gamepad every frame would stomp on a key the player is
  // still physically holding down (and vice versa) the moment the other
  // source reports "not active" for that same action.
  const keyboardActions = useRef<Record<Action, boolean>>(emptyActionMap());
  const gamepadActions = useRef<Record<Action, boolean>>(emptyActionMap());

  // Stato unito (tastiera + pad) tenuto qui e non dentro l'updater di
  // setInput: React in sviluppo (StrictMode) chiama gli updater due volte,
  // anche piu' tardi, e il "premuto adesso" tornava vero dopo essere gia'
  // stato letto -- un tasto premuto una volta valeva due (la copertura si
  // apriva e si richiudeva subito, Q faceva anche il pugno).
  const mergedRef = useRef<Record<Action, boolean>>(emptyActionMap());
  const applyMerged = () => {
    const prev = mergedRef.current;
    let didChange = false;
    const next = { ...prev };
    for (const action of ACTION_NAMES) {
      const value = keyboardActions.current[action] || gamepadActions.current[action];
      if (value !== prev[action]) {
        if (value && !prev[action]) {
          justPressed.current[action] = true;
          if (action === 'shift') {
            const t = performance.now();
            const taps = shiftTaps.current;
            taps.push(t);
            while (taps.length && t - taps[0] > SPRINT_TAP_WINDOW_MS) taps.shift();
          }
        }
        if (!value) justPressed.current[action] = false;
        next[action] = value;
        didChange = true;
      }
    }
    if (didChange) {
      mergedRef.current = next;
      setInput(next);
    }
  };

  const keys: Record<string, Action> = {
    KeyW: 'forward',
    KeyS: 'backward',
    KeyA: 'left',
    KeyD: 'right',
    Space: 'jump',
    ShiftLeft: 'shift',
    KeyE: 'yawRight',
    KeyF: 'enter',
    KeyG: 'enter_passenger',
    KeyX: 'seat_switch',
    KeyC: 'camera',
    KeyB: 'fly',
    KeyQ: 'yawLeft',
    KeyR: 'respawn',
    // "aggiungi dei fari veri alla macchina che accendo a comando" -- 'L'
    // for "luci" (only actually read while driving, see Car.tsx's isCarActive
    // gate on consumeJustPressed('headlights')).
    KeyL: 'headlights',
    Escape: 'pause',
    ControlLeft: 'lockOn',
    Digit1: 'weapon1',
    Digit2: 'weapon2',
    Digit3: 'weapon3',
    Digit4: 'weapon4',
    // casse audio dell'arena (AudioArena.tsx): play/pausa
    KeyM: 'music',
    KeyJ: 'musicCubi',
    KeyK: 'musicSchermo',
    KeyV: 'dodge',
    KeyT: 'talk',
    KeyZ: 'secondary',
    KeyN: 'secondary',
    ControlRight: 'secondary',
  };

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);
    const handleKeyDown = (e: KeyboardEvent) => {
      // scrivendo in un campo (numero nel pannello Debug, chat) i tasti non
      // muovono il personaggio
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const action = keys[e.code];
      // dialogo aperto: si puo' solo camminare (i tasti li legge DialogueBox)
      if (talkState.open && action && !DIALOGUE_FREE_ACTIONS.has(action)) return;
      // Q e' anche la copertura (vicino a un muro vince lei)
      if (e.code === 'KeyQ') keyboardActions.current.cover = true;
      if (action) {
        keyboardActions.current[action] = true;
        applyMerged();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyQ') keyboardActions.current.cover = false;
      const action = keys[e.code];
      if (action) {
        keyboardActions.current[action] = false;
        applyMerged();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
        // ispettore NPC acceso (UI/NpcInspector.tsx): il clic sceglie, non colpisce
        if (useStore.getState().npcInspector) return;
        // "quando clicco sull'hud nn deve contarlo come quando clicco sullo
        // schermo della scena": conta solo il clic sulla scena (il canvas, o
        // col mouse catturato), non quello sul pannello Debug o sui bottoni
        if (!document.pointerLockElement && !(e.target instanceof HTMLCanvasElement)) return;
        // dialogo aperto: il clic non spara
        if (talkState.open) return;
        const action = e.button === 0 ? 'primary' : (e.button === 2 ? 'secondary' : null);
        if (action) {
            keyboardActions.current[action] = true;
            applyMerged();
        }
    };

    const handleMouseUp = (e: MouseEvent) => {
        const action = e.button === 0 ? 'primary' : (e.button === 2 ? 'secondary' : null);
        if (action) {
            keyboardActions.current[action] = false;
            applyMerged();
        }
    };

    // Browsers only fire these two events (no per-button/per-axis events
    // exist), but that's still useful for figuring out how a given pad
    // actually looks to the browser -- notably, non-Xbox-style pads like a
    // PS3 DualShock 3 are very often reported with mapping: "" (not
    // "standard"), which means the button/axis INDICES the poller below
    // assumes (Xbox-style: 0=A/Cross, 1=B/Circle, 2=X/Square, 3=Y/Triangle,
    // axes 0/1=left stick...) may not line up with the physical pad at all.
    // Logging this once on connect is the fastest way to tell "wrong
    // mapping" apart from "browser doesn't see the pad" apart from "pad
    // seen but with garbage/drifting axes".
    const handleGamepadConnected = (e: GamepadEvent) => {
      const p = e.gamepad;
      console.log(
        `[Gamepad] connected: "${p.id}" mapping="${p.mapping || '(none)'}" ` +
        `buttons=${p.buttons.length} axes=${p.axes.length}`
      );
    };
    const handleGamepadDisconnected = (e: GamepadEvent) => {
      console.log(`[Gamepad] disconnected: "${e.gamepad.id}"`);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, []);

  // Gamepad state is never pushed via events -- the browser doesn't fire
  // anything when a stick moves or a button changes -- so it has to be
  // polled every frame. This is safe here because the only callers of
  // useInput (Player/Car/Helicopter/Airplane) are always mounted inside
  // the R3F <Canvas>, so this hook always runs in a useFrame-capable tree.
  useFrame(() => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) {
        pad = pads[i] as Gamepad;
        break;
      }
    }

    const phoneInput = (window as any).__phoneControllerInput;
    if (phoneInput) {
      const axisForward = phoneInput.axes[1] ?? 0;
      const axisStrafe = phoneInput.axes[0] ?? 0;

      if (
        Math.abs(axisForward) > 0.05 ||
        Math.abs(axisStrafe) > 0.05 ||
        phoneInput.buttons.x ||
        phoneInput.buttons.circle ||
        phoneInput.buttons.square ||
        phoneInput.buttons.triangle ||
        phoneInput.buttons.select ||
        phoneInput.buttons.pause ||
        phoneInput.buttons.dpadUp ||
        phoneInput.buttons.dpadDown ||
        phoneInput.buttons.dpadLeft ||
        phoneInput.buttons.dpadRight
      ) {
        pad = {
          id: 'PhoneController',
          mapping: 'standard',
          axes: [
            axisStrafe,
            axisForward,
            phoneInput.axesRight?.[0] ?? 0,
            phoneInput.axesRight?.[1] ?? 0,
          ],
          buttons: [
            { pressed: phoneInput.buttons.x, value: phoneInput.buttons.x ? 1 : 0 }, // 0: X
            { pressed: phoneInput.buttons.circle, value: phoneInput.buttons.circle ? 1 : 0 }, // 1: Circle
            { pressed: phoneInput.buttons.square, value: phoneInput.buttons.square ? 1 : 0 }, // 2: Square
            { pressed: phoneInput.buttons.triangle, value: phoneInput.buttons.triangle ? 1 : 0 }, // 3: Triangle
            {}, {}, {}, {},
            { pressed: phoneInput.buttons.select, value: phoneInput.buttons.select ? 1 : 0 }, // 8: Select (Zoom / Camera)
            { pressed: phoneInput.buttons.pause, value: phoneInput.buttons.pause ? 1 : 0 }, // 9: Pause
            {}, {},
            { pressed: phoneInput.buttons.dpadUp, value: phoneInput.buttons.dpadUp ? 1 : 0 }, // 12: D-pad Up (weapon change)
            { pressed: phoneInput.buttons.dpadDown, value: phoneInput.buttons.dpadDown ? 1 : 0 }, // 13: D-pad Down
            { pressed: phoneInput.buttons.dpadLeft, value: phoneInput.buttons.dpadLeft ? 1 : 0 }, // 14: D-pad Left
            { pressed: phoneInput.buttons.dpadRight, value: phoneInput.buttons.dpadRight ? 1 : 0 }, // 15: D-pad Right
          ],
        } as unknown as Gamepad;
      }
    }

    const g = gamepadActions.current;

    // Live snapshot for the on-screen calibration readout (GamepadDebug.tsx)
    // -- see the connect-log comment above for why this matters: without
    // seeing the raw indices, there's no way to tell a wrong mapping from a
    // pad the browser isn't reading at all.
    if (import.meta.env.DEV) {
      (window as any).__gamepadDebug = pad
        ? {
            id: pad.id,
            mapping: pad.mapping || '(none)',
            axes: Array.from(pad.axes).map((a) => Math.round(a * 100) / 100),
            buttons: pad.buttons
              .map((b, i) => (b.pressed || b.value > 0.15 ? i : -1))
              .filter((i) => i !== -1),
          }
        : null;
    }

    if (!pad) {
      // No pad connected (or it just disconnected) -- make sure nothing
      // stays stuck "on" from a previously connected frame.
      dronePad.lx = dronePad.ly = dronePad.rx = dronePad.ry = dronePad.up = dronePad.down = 0;
      dronePad.rollL = dronePad.rollR = false;
      let hadAny = false;
      for (const action of ACTION_NAMES) {
        if (g[action]) hadAny = true;
        g[action] = false;
      }
      if (hadAny) applyMerged();
      return;
    }

    // Standard gamepad mapping: axes[0]/[1] = left stick, axes[2]/[3] =
    // right stick (right stick look is handled separately, in
    // useThirdPersonCamera). Left stick maps digitally onto the same
    // forward/backward/left/right actions WASD uses.
    const axisForward = pad.axes[1] ?? 0; // negative = stick pushed up/forward
    const axisStrafe = pad.axes[0] ?? 0;

    // "mappa i tasti del joystick come gta" -- schema di GTA V (pad
    // PlayStation, indici del mapping standard: 0 X, 1 Cerchio, 2 Quadrato,
    // 3 Triangolo, 4 L1, 5 R1, 6 L2, 7 R2, 8 Select, 9 Start, 10 L3, 11 R3,
    // 12-15 croce su/giu'/sinistra/destra):
    //   a piedi   levetta sx muove, dx camera; X corsa (tenuto) e scatto
    //             (premuto piu' volte); Quadrato salto; Triangolo sali/scendi
    //             dal veicolo; Cerchio attacco leggero / ricarica; R2 spara /
    //             attacco pesante; L2 mira (con un'arma) o aggancia il
    //             nemico (a mani nude); con L2 tenuto Quadrato e' la
    //             schivata e Triangolo l'attacco alternativo; L1 ruota delle
    //             armi; R1 parata; R3 guarda dietro; L3 capriola; croce:
    //             armi rapide (sx pugni, dx pistola, su fucile), giu' ricarica
    //   in auto   R2 gas, L2 freno/retro, R1 freno a mano, levetta sx sterza,
    //             Triangolo scendi, croce destra fari
    //   in volo   R2 su / gas, L2 giu' / freno, L1 R1 imbardata
    //   drone     Select tenuto prende il drone (e lo lascia); levetta sx
    //             avanti/indietro e imbardata, levetta dx cloche (beccheggio
    //             e virata), R2 sali, L2 scendi, L1/R1 rollio, X
    //             mitragliatrice, Quadrato missile, Triangolo torna a piedi
    const ctrl = useStore.getState().currentControllable;
    const inCar = ctrl === 'car';
    const flying = ctrl === 'helicopter' || ctrl === 'airplane';
    const inDrone = ctrl === 'drone';
    const dz = (v: number | undefined) => (v === undefined || Math.abs(v) < STICK_DEADZONE ? 0 : v);
    dronePad.lx = dz(pad.axes[0]);
    dronePad.ly = dz(pad.axes[1]);
    dronePad.rx = dz(pad.axes[2]);
    dronePad.ry = dz(pad.axes[3]);
    // grilletti: alcuni pad (DualShock 3 e simili) li danno solo come
    // "premuto", con il valore analogico fermo a 0 -- si prende il maggiore
    const trig = (i: number) => {
      const t = pad!.buttons[i];
      return t ? Math.max(t.value || 0, t.pressed ? 1 : 0) : 0;
    };
    dronePad.up = trig(7);
    dronePad.down = trig(6);
    dronePad.rollL = !!pad.buttons[4]?.pressed;
    dronePad.rollR = !!pad.buttons[5]?.pressed;
    const wpn = useStore.getState().playerWeapon;
    const armed = wpn === 'pistol' || wpn === 'rifle';
    const b = (i: number) => !!pad!.buttons[i]?.pressed;
    const l2 = b(6);
    const r2 = b(7);

    g.forward = axisForward < -STICK_DEADZONE || (inCar && r2);
    g.backward = axisForward > STICK_DEADZONE || (inCar && l2);
    g.left = axisStrafe < -STICK_DEADZONE;
    g.right = axisStrafe > STICK_DEADZONE;
    if (inCar) {
      g.jump = b(5); // R1: freno a mano
      g.shift = false;
      g.primary = false;
      g.secondary = false;
      g.yawLeft = false;
      g.yawRight = false;
      g.headlights = b(15);
    } else if (inDrone) {
      g.shift = false;
      g.jump = false;
      g.yawLeft = false;
      g.yawRight = false;
      g.primary = b(0); // X: mitragliatrice (tenuto)
      g.secondary = b(2); // Quadrato: missile
      g.lockOn = false;
      g.headlights = false;
    } else if (flying) {
      g.shift = r2; // su / gas
      g.jump = l2; // giu' / freno
      g.yawLeft = b(4);
      g.yawRight = b(5);
      g.primary = false;
      g.secondary = false;
      g.headlights = false;
    } else {
      g.shift = b(0); // X: corsa / scatto
      g.jump = b(2) && !l2; // Quadrato: salto
      g.primary = r2; // R2: spara / attacco pesante
      // L2: mira con un'arma; a mani nude aggancia il nemico (lockOn),
      // e la parata passa a R1
      g.secondary = armed ? l2 : b(5);
      g.lockOn = !armed && l2;
      g.yawLeft = b(1) && !armed; // Cerchio: attacco leggero (Jab)
      g.yawRight = b(3) && l2 && !armed; // L2 + Triangolo: attacco alternativo
      g.headlights = false;
    }
    g.attackLeft = false;
    // Triangolo col drone: torna a piedi (e finche' resta premuto non fa
    // salire sul veicolo vicino)
    if (inDrone && b(3)) triangleBlocked.current = true;
    else if (!b(3)) triangleBlocked.current = false;
    g.enter = b(3) && !inDrone && !triangleBlocked.current && !(l2 && !armed && !inCar && !flying); // Triangolo: veicolo
    g.dodge = ((b(2) && l2) || b(10)) && !inCar && !flying && !inDrone; // L2 + Quadrato, o L3: schivata
    g.reload = (b(13) || (b(1) && armed && !inCar && !flying)) && !inDrone; // croce giu' o Cerchio con un'arma
    g.weapon1 = b(14) && !inCar && !inDrone; // croce sinistra: pugni
    g.weapon2 = b(15) && !inCar && !inDrone; // croce destra: pistola
    g.weapon3 = b(12) && !inDrone; // croce su: fucile
    // Select premuto e rilasciato: le 4 distanze della camera (ZOOM_LEVELS in
    // useThirdPersonCamera.ts); tenuto DRONE_HOLD_MS: prendi / lascia il drone
    const now = performance.now();
    let selectTap = false;
    let selectHold = false;
    if (b(8)) {
      if (!selectDownAt.current) selectDownAt.current = now;
      if (!selectHoldFired.current && now - selectDownAt.current >= DRONE_HOLD_MS) {
        selectHoldFired.current = true;
        selectHold = true;
      }
    } else if (selectDownAt.current) {
      selectTap = !selectHoldFired.current;
      selectDownAt.current = 0;
      selectHoldFired.current = false;
    }
    g.camera = selectTap && !inDrone;
    g.fly = selectHold || (inDrone && b(3));
    // R1: copertura (a piedi)
    g.cover = b(5) && !inCar && !flying && !inDrone;
    // vicino a un personaggio (lib/dialogue.ts): Triangolo parla, non sale
    // in auto; col dialogo aperto i tasti li legge DialogueBox
    g.talk = false;
    if (!inCar && !flying && !inDrone && (talkState.near || talkState.open)) {
      g.talk = b(3) && !talkState.open;
      g.enter = false;
    }
    if (talkState.open) {
      for (const a of ACTION_NAMES) if (!DIALOGUE_FREE_ACTIONS.has(a)) g[a] = false;
    }
    // Start: pausa (la gestisce GameFreeze.tsx anche a gioco fermo)
    g.pause = b(9);

    applyMerged();
  });

  const consumeJustPressed = (action: string) => {
    if (justPressed.current[action]) {
        justPressed.current[action] = false;
        return true;
    }
    return false;
  };

  // quanto si sta "pestando" il tasto corsa (0..1): come in GTA, tenerlo
  // premuto fa correre, premerlo piu' volte di fila fa scattare; smette di
  // contare appena si smette di premere
  const sprintMash = () => {
    const now = performance.now();
    const taps = shiftTaps.current;
    while (taps.length && now - taps[0] > SPRINT_TAP_WINDOW_MS) taps.shift();
    return Math.min(1, Math.max(0, (taps.length - 1) / 3));
  };

  return { ...input, consumeJustPressed, sprintMash };
};
