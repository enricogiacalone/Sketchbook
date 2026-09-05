import { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

const STICK_DEADZONE = 0.25;

const ACTION_NAMES = [
  'forward', 'backward', 'left', 'right', 'jump', 'shift',
  'yawLeft', 'yawRight', 'enter', 'enter_passenger', 'seat_switch',
  'camera', 'fly', 'respawn', 'primary', 'secondary',
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

  const keys = {
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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
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
    g.enter = !!pad.buttons[2]?.pressed; // X / Square: enter/exit vehicle
    g.enter_passenger = !!pad.buttons[3]?.pressed; // Y / Triangle
    g.respawn = !!pad.buttons[9]?.pressed; // Start

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
