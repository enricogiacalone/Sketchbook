import { useEffect, useState, useRef } from 'react';

export const useInput = () => {
  const [input, setInput] = useState({
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

  // Refs are better for "just pressed" as they don't trigger re-renders 
  // and are immediate for useFrame consumption.
  const justPressed = useRef<Record<string, boolean>>({});

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
        setInput((prev) => {
            if (!prev[action]) justPressed.current[action] = true;
            return { ...prev, [action]: true };
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const action = keys[e.code];
      if (action) {
        setInput((prev) => ({ ...prev, [action]: false }));
        justPressed.current[action] = false;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
        const action = e.button === 0 ? 'primary' : (e.button === 2 ? 'secondary' : null);
        if (action) {
            setInput(prev => {
                if (!prev[action]) justPressed.current[action] = true;
                return { ...prev, [action]: true };
            });
        }
    };

    const handleMouseUp = (e: MouseEvent) => {
        const action = e.button === 0 ? 'primary' : (e.button === 2 ? 'secondary' : null);
        if (action) {
            setInput(prev => ({ ...prev, [action]: false }));
            justPressed.current[action] = false;
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

  const consumeJustPressed = (action: string) => {
    if (justPressed.current[action]) {
        justPressed.current[action] = false;
        return true;
    }
    return false;
  };

  return { ...input, consumeJustPressed };
};
