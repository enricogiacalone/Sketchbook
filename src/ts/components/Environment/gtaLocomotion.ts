// "voglio un gioco che ha come locomotion lo stesso stile di gta4": il
// movimento a piedi libero (senza mira e senza lock-on) con il "peso" di
// GTA IV invece dello scatto istantaneo di prima:
// - inerzia: si accelera e si frena in qualche decimo di secondo, la corsa
//   parte e si ferma con qualche passo;
// - curve: il corpo gira con una velocita' angolare limitata, piu' lenta
//   quanto piu' si va veloci (in corsa si fanno archi larghi), e si muove
//   dove guarda, non dove punta lo stick; le curve strette fanno rallentare;
//   un'inversione in corsa e' una frenata che gira sul posto;
// - inclinazione: il corpo pende verso l'interno della curva;
// - passo: camminata e corsa si mescolano in base alla velocita' con i
//   piedi in fase (lo stesso piede appoggia nello stesso istante in tutte
//   e due le clip) e la cadenza segue la velocita' vera, cosi' i piedi non
//   scivolano a nessuna velocita' intermedia.

// Fase (0..1) in cui il piede sinistro tocca terra in ogni clip -- misurata
// sulle animazioni (scratch: fit/gait.mjs, piede al minimo + 2 cm). Ogni
// clip e' un ciclo intero (un appoggio sinistro e uno destro).
export const LEFT_CONTACT: Record<string, number> = {
  Walk: 0.967,
  Run_Female: 0.55,
  Jog: 0.008,
  Sprint: 0.992,
  Walk_Female: 0.475,
  Walk_Backwards: 0.45,
  Strafe_left: 0.942,
  Strafe_right: 0.417,
};

export const gtaLoco = {
  accelWalk: 3.2, // m/s^2 da fermo alla camminata
  accelRun: 4.5, // m/s^2 verso la corsa
  decel: 6.5, // m/s^2 frenata normale
  skidDecel: 11, // m/s^2 inversione in corsa
  turnStill: 10, // rad/s girando da fermo
  turnWalk: 6.5, // rad/s alla camminata
  turnRun: 3.3, // rad/s alla corsa
  sharpTurn: 2.3, // rad: oltre, in corsa, e' un'inversione (frenata)
  slowInTurn: 0.45, // quanto si rallenta (0-1) nelle curve strette
  maxLean: 0.14, // rad (~8 gradi)
  leanPerTurn: 0.03, // rad per (rad/s * m/s)
  leanEase: 7, // 1/s
};

export interface LocoState {
  speed: number; // m/s, sempre >= 0, nella direzione in cui guarda il corpo
  phase: number; // 0..1 nel ciclo del passo (0 = appoggio sinistro)
  lean: number; // rad, + = verso la sinistra del corpo
  turnRate: number; // rad/s dell'ultimo passo
  skidding: boolean;
}

export const newLocoState = (): LocoState => ({ speed: 0, phase: 0, lean: 0, turnRate: 0, skidding: false });

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Un passo: dove si gira il corpo e a che velocita' va. `rotation` e' la
// convenzione dei combattenti (avanti = (-sin, -cos)); `target` la
// rotazione voluta (null: nessuna direzione), `want` la velocita' voluta.
export function stepLoco(s: LocoState, rotation: number, target: number | null, want: number, runSpeed: number, dt: number): number {
  let rot = rotation;
  let wantSpeed = want;
  s.skidding = false;
  if (target !== null) {
    const diff = wrap(target - rot);
    const run01 = Math.min(1, s.speed / Math.max(0.1, runSpeed));
    const walk01 = Math.min(1, s.speed / 1.2);
    const maxTurn =
      s.speed < 1.2
        ? gtaLoco.turnStill + (gtaLoco.turnWalk - gtaLoco.turnStill) * walk01
        : gtaLoco.turnWalk + (gtaLoco.turnRun - gtaLoco.turnWalk) * run01;
    if (Math.abs(diff) > gtaLoco.sharpTurn && s.speed > runSpeed * 0.55) {
      // inversione in corsa: si frena girando, poi si riparte
      s.skidding = true;
      wantSpeed = 0;
    } else if (Math.abs(diff) > 0.6) {
      wantSpeed *= 1 - gtaLoco.slowInTurn * Math.min(1, (Math.abs(diff) - 0.6) / 1.4);
    }
    const step = Math.max(-maxTurn * dt, Math.min(maxTurn * dt, diff));
    rot = wrap(rot + step);
    s.turnRate = step / Math.max(1e-4, dt);
  } else s.turnRate = 0;
  // velocita'
  if (wantSpeed > s.speed) {
    const a = s.speed < 1.3 ? gtaLoco.accelWalk : gtaLoco.accelRun;
    s.speed = Math.min(wantSpeed, s.speed + a * dt);
  } else {
    const d = s.skidding ? gtaLoco.skidDecel : gtaLoco.decel;
    s.speed = Math.max(wantSpeed, s.speed - d * dt);
  }
  // inclinazione verso l'interno della curva (girare a sinistra = rotazione che cresce)
  const leanWant = Math.max(-gtaLoco.maxLean, Math.min(gtaLoco.maxLean, s.turnRate * s.speed * gtaLoco.leanPerTurn));
  s.lean += (leanWant - s.lean) * Math.min(1, gtaLoco.leanEase * dt);
  return rot;
}

// pesi di fermo / camminata / corsa per una velocita'
export function locoWeights(speed: number, walkSpeed: number, runSpeed: number): { idle: number; walk: number; run: number } {
  if (speed <= walkSpeed) {
    const w = Math.min(1, speed / Math.max(0.05, walkSpeed * 0.45));
    return { idle: 1 - w, walk: w, run: 0 };
  }
  const r = Math.min(1, (speed - walkSpeed) / Math.max(0.05, runSpeed - walkSpeed));
  const sm = r * r * (3 - 2 * r);
  return { idle: 0, walk: 1 - sm, run: sm };
}
