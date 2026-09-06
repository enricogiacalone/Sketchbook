import { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

const STICK_DEADZONE = 0.25;

const ACTION_NAMES = [
  'forward', 'backward', 'left', 'right', 'jump', 'shift',
  'yawLeft', 'yawRight', 'enter', 'enter_passenger', 'seat_switch',
  'camera', 'fly', 'respawn', 'primary', 'secondary', 'pause',
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
});

export const useInput = () => {
  const [input, setInput] = useState(emptyActionMap);

  // Refs are better for "just pressed" as they don't trigger re-renders
  // and are immediate for useFrame consumption.
  const justPressed = useRef<Record<string, boolean>>({});

  // Keyboard/mouse and gamepad are two independent sources, each tracked
  // on its own and OR-ed together into `input` below. Without this split,
  // polling the gamepad every frame would stomp on a key the player is
  // still physically holding down (and vice versa) the moment the other
  // source reports "not active" for that same action.
  const keyboardActions = useRef<Record<Action, boolean>>(emptyActionMap());
  const gamepadActions = useRef<Record<Action, boolean>>(emptyActionMap());

  const applyMerged = () => {
    setInput((prev) => {
      let didChange = false;
      const next = { ...prev };
      for (const action of ACTION_NAMES) {
        const value = keyboardActions.current[action] || gamepadActions.current[action];
        if (value !== prev[action]) {
          if (value && !prev[action]) justPressed.current[action] = true;
          if (!value) justPressed.current[action] = false;
          next[action] = value;
          didChange = true;
        }
      }
      return didChange ? next : prev;
    });
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
    Escape: 'pause',
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = keys[e.code];
      if (action) {
        keyboardActions.current[action] = true;
        applyMerged();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const action = keys[e.code];
      if (action) {
        keyboardActions.current[action] = false;
        applyMerged();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
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

    g.forward = axisForward < -STICK_DEADZONE;
    g.backward = axisForward > STICK_DEADZONE;
    g.left = axisStrafe < -STICK_DEADZONE;
    g.right = axisStrafe > STICK_DEADZONE;
    g.jump = !!pad.buttons[0]?.pressed; // A / Cross
    g.shift = !!pad.buttons[5]?.pressed || !!pad.buttons[6]?.pressed; // RB or LT: run
    g.primary = !!pad.buttons[7]?.pressed; // RT: fire
    g.secondary = !!pad.buttons[1]?.pressed; // B / Circle
    // X/Square AND Y/Triangle both enter/exit a vehicle -- Triangle used to
    // drive the separate (and entirely unused -- nothing ever read
    // input.enter_passenger) 'enter_passenger' action; folded into 'enter'
    // per request so Triangle actually does something.
    g.enter = !!pad.buttons[2]?.pressed || !!pad.buttons[3]?.pressed; // Square or Triangle
    // Back/Select: cycle the camera's 4 zoom presets (see ZOOM_LEVELS in
    // useThirdPersonCamera.ts). Reuses the 'camera' action, which already
    // existed with a keyboard binding (KeyC) but, like enter_passenger
    // above, had nothing reading it anywhere.
    g.camera = !!pad.buttons[8]?.pressed;
    // Start: pause/resume (see isPaused in store.ts). This used to drive
    // 'respawn', which -- same story again -- nothing ever read; KeyR still
    // fires it from the keyboard side in case that's wired up later.
    g.pause = !!pad.buttons[9]?.pressed;

    applyMerged();
  });

  const consumeJustPressed = (action: string) => {
    if (justPressed.current[action]) {
        justPressed.current[action] = false;
        return true;
    }
    return false;
  };

  return { ...input, consumeJustPressed };
};
