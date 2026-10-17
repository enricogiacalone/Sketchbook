import * as THREE from 'three';

// Inertializzazione (Bollo, GDC 2018): invece di sfumare tra due clip (che
// sovrappone due pose diverse e da' il "doppio" a meta' strada), al cambio si
// passa subito alla nuova clip e si somma alle ossa lo scarto tra la posa che
// c'era e la posa nuova; lo scarto poi svanisce in una frazione di secondo con
// una molla smorzata criticamente. La posa non salta mai e non c'e' il
// fantasma di due movimenti insieme, qualunque sia la clip di arrivo.
//
// Uso (ogni frame, subito dopo mixer.update): applica(dt). Quando la sorgente
// dell'animazione cambia (clip diversa, passo normale <-> clip Kimodo...)
// chiamare cambio() PRIMA di quel frame; la posa di riferimento e' quella
// finale del frame precedente.

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _id = new THREE.Quaternion();

export class Inertializer {
  private bones: THREE.Object3D[] = [];
  private last: THREE.Quaternion[] = [];
  // posa grezza (prima dello scarto): il mixer riscrive solo le ossa che le clip
  // in corso animano; le altre (spine_01 in Walk, neck_02...) terrebbero lo scarto
  // del frame prima e lo sommerebbero a ogni frame. Si ripristina prima del mixer.
  private raw: THREE.Quaternion[] = [];
  private rawPos = new THREE.Vector3();
  private dirty = false;
  private offset: THREE.Quaternion[] = [];
  private hips: THREE.Object3D | null = null;
  private lastPos = new THREE.Vector3();
  private offPos = new THREE.Vector3();
  private pending = false;
  private active = false;
  private t = 0;
  // frequenza della molla: lo scarto scende a ~5% in circa 3/k secondi
  k = 11;
  private haveLast = false;

  constructor(root: THREE.Object3D, hipsName = 'pelvis') {
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.bones.push(o);
        this.last.push(new THREE.Quaternion());
        this.raw.push(new THREE.Quaternion());
        this.offset.push(new THREE.Quaternion());
        if (o.name === hipsName) this.hips = o;
      }
    });
  }

  // la sorgente dell'animazione sta per cambiare
  cambio() {
    if (this.haveLast) this.pending = true;
  }

  // da chiamare subito PRIMA di mixer.update: toglie lo scarto del frame precedente
  ripristina() {
    if (!this.dirty) return;
    this.dirty = false;
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.copy(this.raw[i]);
    if (this.hips) this.hips.position.copy(this.rawPos);
  }

  applica(dt: number) {
    // (prova: window.__noInertial = true la spegne, per confrontare)
    if ((window as any).__noInertial) {
      this.pending = false;
      this.active = false;
    }
    // posa grezza di questo frame, da rimettere prima del prossimo mixer.update
    for (let i = 0; i < this.bones.length; i++) this.raw[i].copy(this.bones[i].quaternion);
    if (this.hips) this.rawPos.copy(this.hips.position);
    this.dirty = true;
    if (this.pending) {
      this.pending = false;
      // scarto = posa di prima * (posa nuova)^-1, cosi' scarto * nuova = di prima
      for (let i = 0; i < this.bones.length; i++) {
        _qi.copy(this.bones[i].quaternion).invert();
        this.offset[i].copy(this.last[i]).multiply(_qi);
      }
      if (this.hips) this.offPos.copy(this.lastPos).sub(this.hips.position);
      this.t = 0;
      this.active = true;
    }
    if (this.active) {
      this.t += dt;
      const e = Math.exp(-this.k * this.t);
      const w = (1 + this.k * this.t) * e; // 1 -> 0, derivata nulla all'inizio
      if (w < 0.01) this.active = false;
      else {
        for (let i = 0; i < this.bones.length; i++) {
          _q.copy(_id).slerp(this.offset[i], w);
          this.bones[i].quaternion.premultiply(_q);
        }
        if (this.hips) this.hips.position.addScaledVector(this.offPos, w);
      }
    }
    for (let i = 0; i < this.bones.length; i++) this.last[i].copy(this.bones[i].quaternion);
    if (this.hips) this.lastPos.copy(this.hips.position);
    this.haveLast = true;
  }

  // per i test e il pannello debug
  get inCorso() {
    return this.active;
  }
}
