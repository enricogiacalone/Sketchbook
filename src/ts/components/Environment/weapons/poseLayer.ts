import * as THREE from 'three';

// "deve usare solo una mano per reggere la pistola, l'altra sta normale":
// le clip Pistol_* del personaggio sono a due mani e prima prendevano tutto
// il busto (layer __upper). Qui le clip girano su copie "finte" delle ossa
// (un mixer a parte, niente mesh) e dopo l'animazione normale si copiano
// sulle ossa vere solo quelle scelte: per tenere la pistola il braccio
// destro (clavicola, braccio, avambraccio, mano e dita), per ricaricare
// tutte e due le braccia. Il resto del corpo -- e quindi la camminata, la
// corsa, l'altro braccio che oscilla -- resta quello dell'animazione di
// sempre. Non si possono usare due azioni dello stesso mixer sulle stesse
// ossa: three.js ne farebbe la media, a meta' strada fra le due pose.

export class PoseLayer {
  private root = new THREE.Object3D();
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private proxies = new Map<string, THREE.Object3D>();
  private real = new Map<string, THREE.Object3D>();
  private current: string | null = null;

  // rig: lo scheletro vero; clips: le clip da far girare; bones: tutte le
  // ossa che una maschera potra' mai chiedere
  constructor(rig: THREE.Object3D, clips: THREE.AnimationClip[], bones: string[]) {
    for (const n of bones) {
      const b = rig.getObjectByName(n);
      if (!b) continue;
      const p = new THREE.Object3D();
      p.name = n;
      p.quaternion.copy(b.quaternion);
      this.root.add(p);
      this.proxies.set(n, p);
      this.real.set(n, b);
    }
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const c of clips) {
      const tracks = c.tracks.filter((t) => {
        const [bone, prop] = t.name.split('.');
        return prop === 'quaternion' && this.proxies.has(bone);
      });
      this.actions[c.name] = this.mixer.clipAction(new THREE.AnimationClip(c.name, c.duration, tracks));
    }
  }

  has(name: string) {
    return !!this.actions[name];
  }

  // la clip da tenere (null: nessuna). once = una volta e resta all'ultima posa
  set(name: string | null, opts: { once?: boolean; timeScale?: number; restart?: boolean } = {}) {
    if (name === this.current && !opts.restart) return;
    const prev = this.current ? this.actions[this.current] : null;
    if (prev && name !== this.current) prev.fadeOut(0.15);
    this.current = name;
    const a = name ? this.actions[name] : null;
    if (!a) return;
    a.reset();
    a.setEffectiveTimeScale(opts.timeScale ?? 1);
    a.setEffectiveWeight(1);
    a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, opts.once ? 1 : Infinity);
    a.clampWhenFinished = !!opts.once;
    if (prev === a) a.play();
    else a.fadeIn(opts.restart ? 0.05 : 0.15).play();
  }

  // dopo il mixer del personaggio: per ogni gruppo di ossa (key) la posa del
  // layer con la sua dissolvenza (on = quel gruppo deve seguire il layer).
  // Gruppi diversi entrano ed escono ognuno col suo tempo: la mano che
  // impugna resta sempre, il braccio si alza solo per mirare.
  private ws = new Map<string, number>();
  weight(key: string) {
    return this.ws.get(key) ?? 0;
  }
  apply(groups: { key: string; bones: string[]; on: boolean }[], dt: number) {
    let any = false;
    for (const g of groups) {
      const w = (this.ws.get(g.key) ?? 0) + ((g.on ? 1 : 0) - (this.ws.get(g.key) ?? 0)) * Math.min(1, dt * 10);
      this.ws.set(g.key, w < 0.001 ? 0 : w);
      if (w >= 0.001) any = true;
    }
    if (!any) return;
    this.mixer.update(dt);
    for (const g of groups) {
      const w = this.ws.get(g.key) ?? 0;
      if (w <= 0) continue;
      for (const n of g.bones) {
        const p = this.proxies.get(n);
        const b = this.real.get(n);
        if (p && b) b.quaternion.slerp(p.quaternion, w);
      }
    }
  }
}

// nomi delle ossa da `from` in giu' (compreso)
export function boneChain(rig: THREE.Object3D, from: string): string[] {
  const out: string[] = [];
  rig.getObjectByName(from)?.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(o.name);
  });
  return out;
}
