import { useEffect, useState } from 'react';

export const useInput = () => {
  const [input, setInput] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    shift: false,
    use: false,
    enter: false,
    enter_passenger: false,
    seat_switch: false,
    camera: false,
    fly: false,
    down: false,
    respawn: false,
    primary: false,
    secondary: false,
  });

  const keys = {
    KeyW: 'forward',
    KeyS: 'backward',
    KeyA: 'left',
    KeyD: 'right',
    Space: 'jump',
    ShiftLeft: 'shift',
    KeyE: 'use',
    KeyF: 'enter',
    KeyG: 'enter_passenger',
    KeyX: 'seat_switch',
    KeyC: 'camera',
    KeyB: 'fly',
    KeyQ: 'down',
    KeyR: 'respawn',
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (keys[e.code]) {
        setInput((prev) => ({ ...prev, [keys[e.code]]: true }));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (keys[e.code]) {
        setInput((prev) => ({ ...prev, [keys[e.code]]: false }));
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
        if (e.button === 0) setInput((prev) => ({ ...prev, primary: true }));
        if (e.button === 2) setInput((prev) => ({ ...prev, secondary: true }));
    };

    const handleMouseUp = (e: MouseEvent) => {
        if (e.button === 0) setInput((prev) => ({ ...prev, primary: false }));
        if (e.button === 2) setInput((prev) => ({ ...prev, secondary: false }));
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

  return input;
};
