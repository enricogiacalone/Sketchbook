// Sospensioni della moto (visive e dinamiche, come quelle della macchina: molla + smorzatore): il telaio e
// tutto cio' che porta (sella, pilota, serbatoio, manubrio) e' la massa sospesa; le ruote restano a terra. Due gradi di
// liberta': sobbalzo verticale (h) e beccheggio (q, positivo = muso in alto). Li muovono l'accelerazione verticale
// della base (buche, dossi, salti) e quella longitudinale (frenando la moto si "siede" sull'avantreno, accelerando
// si impenna un po'). Le compressioni di forcella e mono-ammortizzatore escono da qui.

import { MOTO } from './motorcycleGeometry';

// come la macchina (Car.tsx: rigidezza 20 1/s^2, smorzamento 2 1/s), ma piu' dura e piu' smorzata: una moto e' leggera
const HEAVE_W = 8; // rad/s
const HEAVE_ZETA = 0.38;
const PITCH_W = 7;
const PITCH_ZETA = 0.34;
const PITCH_PER_ACCEL = 0.0125; // rad per m/s^2 (a 8 m/s^2: ~6 gradi)
const MAX_H = 0.1; // corsa massima, m
const MAX_Q = 0.11; // rad (~6 gradi)
const HALF_BASE = MOTO.wheelbase / 2;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export class MotoSuspension {
  h = 0;
  hv = 0;
  q = 0;
  qv = 0;
  private prevSpeed: number | null = null;
  private prevVy: number | null = null;
  private accLong = 0;
  private accVert = 0;

  // dt in secondi; speed (m/s in avanti) e vy (m/s verticale della base) sono le misure di questo frame
  update(dt: number, speed: number, vy: number) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    if (this.prevSpeed !== null) {
      // filtrate: la fisica a 120 Hz da' derivate rumorose
      const aL = clamp((speed - this.prevSpeed) / dt, -18, 18);
      const aV = clamp(((vy ?? 0) - (this.prevVy ?? 0)) / dt, -40, 40);
      const k = Math.min(1, 12 * dt);
      this.accLong += (aL - this.accLong) * k;
      this.accVert += (aV - this.accVert) * k;
    }
    this.prevSpeed = speed;
    this.prevVy = vy;
    // integrazione semi-implicita a passi piccoli (la molla e' rigida)
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.hv += (-HEAVE_W * HEAVE_W * this.h - 2 * HEAVE_ZETA * HEAVE_W * this.hv - this.accVert) * h;
      this.h += this.hv * h;
      const qTarget = PITCH_PER_ACCEL * this.accLong;
      this.qv += (-PITCH_W * PITCH_W * (this.q - qTarget) - 2 * PITCH_ZETA * PITCH_W * this.qv) * h;
      this.q += this.qv * h;
      // arrivi a fondo corsa: la velocita' si annulla (tampone)
      if (Math.abs(this.h) > MAX_H) {
        this.h = clamp(this.h, -MAX_H, MAX_H);
        this.hv *= -0.2;
      }
      if (Math.abs(this.q) > MAX_Q) {
        this.q = clamp(this.q, -MAX_Q, MAX_Q);
        this.qv *= -0.2;
      }
    }
  }

  // quanto si e' allungata (+) o compressa (-) la forcella davanti e il mono dietro, in metri verticali
  get frontExtension() {
    return this.h + this.q * HALF_BASE;
  }
  get rearExtension() {
    return this.h - this.q * HALF_BASE;
  }
}
