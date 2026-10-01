import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../../store';
import { weaponWheel, WHEEL_SLOTS, slotOfWeapon, wheelWeaponAt, WheelWeapon } from '../../lib/weaponWheel';

// Comandi della ruota delle armi (come GTA V):
// - tieni premuto Tab (tastiera) o L1 (pad) -> si apre;
// - muovi il mouse / la levetta destra verso un settore -> lo evidenzi
//   (i settori vuoti non si scelgono);
// - rotella del mouse o croce sinistra/destra -> cambi arma nel settore
//   (es. pugni / coltello);
// - rilasci -> impugni l'arma evidenziata.
// Niente rallentatore: siamo in multiplayer (come GTA Online).
// Solo a piedi e vivo; mentre e' aperta la camera e gli attacchi sono fermi
// (store.weaponWheelOpen, letto da useThirdPersonCamera e PlayerCombatSoldier).
const AIM_RADIUS = 140; // px, raggio del puntatore virtuale
const SELECT_MIN = 28; // px dal centro per scegliere un settore
const STICK_MIN = 0.5;

const WeaponWheelController: React.FC<{ footControllable: string; isDead: () => boolean }> = ({ footControllable, isDead }) => {
  const { gl } = useThree();
  const tabDown = useRef(false);
  const padPrev = useRef<{ l1: boolean; left: boolean; right: boolean }>({ l1: false, left: false, right: false });

  const cycle = (dir: number) => {
    const s = WHEEL_SLOTS[weaponWheel.slot];
    if (!s || s.weapons.length < 2) return;
    const n = s.weapons.length;
    weaponWheel.pick[weaponWheel.slot] = (weaponWheel.pick[weaponWheel.slot] + dir + n) % n;
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault(); // niente cambio di focus del browser
        tabDown.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        tabDown.current = false;
      }
    };
    const move = (e: MouseEvent) => {
      if (!weaponWheel.open) return;
      if (document.pointerLockElement === gl.domElement) {
        weaponWheel.aimX += e.movementX;
        weaponWheel.aimY += e.movementY;
      } else {
        weaponWheel.aimX = e.clientX - window.innerWidth / 2;
        weaponWheel.aimY = e.clientY - window.innerHeight / 2;
      }
      const l = Math.hypot(weaponWheel.aimX, weaponWheel.aimY);
      if (l > AIM_RADIUS) {
        weaponWheel.aimX *= AIM_RADIUS / l;
        weaponWheel.aimY *= AIM_RADIUS / l;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!weaponWheel.open) return;
      cycle(e.deltaY > 0 ? 1 : -1);
    };
    const blur = () => {
      tabDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousemove', move);
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
      weaponWheel.open = false;
      useStore.getState().setWeaponWheelOpen(false);
    };
  }, [gl]);

  useFrame(() => {
    const st = useStore.getState();
    // pad
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i] as Gamepad; break; }
    const l1 = !!pad?.buttons[4]?.pressed;
    const left = !!pad?.buttons[14]?.pressed;
    const right = !!pad?.buttons[15]?.pressed;

    const canOpen = st.currentControllable === footControllable && !isDead() && !st.isPaused;
    const want = canOpen && (tabDown.current || l1);

    if (want && !weaponWheel.open) {
      // si apre sul settore dell'arma in mano
      weaponWheel.open = true;
      const cur = st.playerWeapon as WheelWeapon;
      const slot = slotOfWeapon(cur);
      if (slot >= 0) {
        weaponWheel.slot = slot;
        weaponWheel.pick[slot] = Math.max(0, WHEEL_SLOTS[slot].weapons.indexOf(cur));
      }
      weaponWheel.aimX = 0;
      weaponWheel.aimY = 0;
      st.setWeaponWheelOpen(true);
    } else if (!want && weaponWheel.open) {
      // chiusa: impugna l'arma evidenziata
      weaponWheel.open = false;
      st.setWeaponWheelOpen(false);
      const w = wheelWeaponAt(weaponWheel.slot);
      if (canOpen && w && w !== st.playerWeapon) st.setRequestedWeapon(w);
    }

    if (weaponWheel.open) {
      // levetta destra
      if (pad) {
        const rx = pad.axes[2] ?? 0;
        const ry = pad.axes[3] ?? 0;
        if (Math.hypot(rx, ry) > STICK_MIN) {
          weaponWheel.aimX = rx * AIM_RADIUS;
          weaponWheel.aimY = ry * AIM_RADIUS;
        }
        if (left && !padPrev.current.left) cycle(-1);
        if (right && !padPrev.current.right) cycle(1);
      }
      // settore puntato (solo se ha armi)
      if (Math.hypot(weaponWheel.aimX, weaponWheel.aimY) > SELECT_MIN) {
        const ang = Math.atan2(weaponWheel.aimX, -weaponWheel.aimY); // 0 = su, orario
        const slot = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
        if (WHEEL_SLOTS[slot].weapons.length > 0) weaponWheel.slot = slot;
      }
    }
    padPrev.current = { l1, left, right };
  });

  return null;
};

export default WeaponWheelController;
