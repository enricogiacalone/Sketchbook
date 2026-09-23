import { useEffect } from 'react';
import { useStore } from '../../store';
import type { RagdollBenchSettings } from '../Environment/ragdoll/ragdollBench';
import { acquireDebugGui, releaseDebugGui } from '../../lib/debugGui';

// "metti il personaggio a T e sistema queste ossa della ragdoll attiva..
// sistema l'ambiente per fare i test come si deve" -- pannello dedicato
// al banco di prova del ragdoll attivo. I controlli sono legati allo
// store con getter/setter + .listen(), cosi' restano sempre allineati
// anche se lo stesso campo cambia da un altro pannello o da uno script.
const TEST_HIT_SEGMENTS: Record<string, string> = {
  'Colpo: testa': 'Head',
  'Colpo: petto': 'SpineHigh',
  'Colpo: pancia': 'Torso',
  'Colpo: bacino': 'Hips',
  'Colpo: braccio sx': 'UpperArm_L',
  'Colpo: braccio dx': 'UpperArm_R',
  'Colpo: coscia sx': 'Thigh_L',
};

const NO_CLIP = '(gioco normale)';

const RagdollBenchGUI: React.FC = () => {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const gui = acquireDebugGui();
    const folder = gui.addFolder('Banco ragdoll');
    const st = () => useStore.getState();
    const bench = () => st().ragdollBench;
    const setBench = (p: Partial<RagdollBenchSettings>) => st().setRagdollBench(p);

    const bind = {
      get ragdollAttivo() { return st().euphoriaRagdollEnabled; },
      set ragdollAttivo(v: boolean) { st().setEuphoriaRagdollEnabled(v); },
      get tPose() { return st().tPoseDebug; },
      set tPose(v: boolean) { st().setTPoseDebug(v); },
      get mostraCorpi() { return st().showActiveRagdollDebug; },
      set mostraCorpi(v: boolean) { st().setShowActiveRagdollDebug(v); },
      get mostraBersagli() { return bench().showTargets; },
      set mostraBersagli(v: boolean) { setBench({ showTargets: v }); },
      get tabella() { return bench().showOverlay; },
      set tabella(v: boolean) { setBench({ showOverlay: v }); },
      get passivo() { return st().ragdollPassive; },
      set passivo(v: boolean) { st().setRagdollPassive(v); },
      get bacinoAncorato() { return bench().pinHips; },
      set bacinoAncorato(v: boolean) { setBench({ pinHips: v }); },
      get gravita() { return bench().aliveGravityScale; },
      set gravita(v: number) { setBench({ aliveGravityScale: v }); },
      get rigidita() { return bench().stiffnessMul; },
      set rigidita(v: number) { setBench({ stiffnessMul: v }); },
      get smorzamento() { return bench().dampingRatio; },
      set smorzamento(v: number) { setBench({ dampingRatio: v }); },
      get servoMondo() { return bench().worldDriveFreq; },
      set servoMondo(v: number) { setBench({ worldDriveFreq: v }); },
      get feedForward() { return bench().motorFeedForward; },
      set feedForward(v: boolean) { setBench({ motorFeedForward: v }); },
      get soloFisica() { return bench().physicsOnlyRender; },
      set soloFisica(v: boolean) { setBench({ physicsOnlyRender: v }); },
      get clip() { return bench().benchClip ?? NO_CLIP; },
      set clip(v: string) { setBench({ benchClip: v === NO_CLIP ? null : v }); },
      get forzaColpo() { return bench().testHitSpeed; },
      set forzaColpo(v: number) { setBench({ testHitSpeed: v }); },
      get pausa() { return st().isPaused; },
      set pausa(v: boolean) { st().setPaused(v); },
      get cameraOrto() { return st().debugOrthoCamera; },
      set cameraOrto(v: boolean) { st().setDebugOrthoCamera(v); },
    };

    folder.add(bind, 'ragdollAttivo').name('Ragdoll attivo').listen();
    folder.add(bind, 'tPose').name('T-pose (bersaglio = T)').listen();
    folder.add(bind, 'mostraCorpi').name('Mostra corpi fisici').listen();
    folder.add(bind, 'mostraBersagli').name('Mostra bersagli (bianco)').listen();
    folder.add(bind, 'tabella').name('Tabella errori/giunti').listen();
    folder.add(bind, 'soloFisica').name('Modello = solo fisica').listen();
    folder.add(bind, 'passivo').name('Passivo (motori spenti)').listen();
    folder.add(bind, 'bacinoAncorato').name('Bacino ancorato').listen();
    folder.add(bind, 'gravita', 0, 1, 0.05).name('Gravita ragdoll vivo').listen();
    folder.add(bind, 'rigidita', 0.1, 4, 0.05).name('Rigidita motori x').listen();
    folder.add(bind, 'smorzamento', 0.2, 3, 0.05).name('Smorzamento (rapporto)').listen();
    folder.add(bind, 'servoMondo', 0, 40, 1).name('Servo mondo (rad/s)').listen();
    folder.add(bind, 'feedForward').name('Feed-forward velocita').listen();
    let clipCtrl = folder.add(bind, 'clip', [NO_CLIP]).name('Animazione di prova').listen();
    folder.add(bind, 'forzaColpo', 1, 20, 0.5).name('Forza colpo (m/s)').listen();
    for (const [label, seg] of Object.entries(TEST_HIT_SEGMENTS)) {
      folder.add({ f: () => (window as any).__ragdollBench?.hit(seg) }, 'f').name(label);
    }
    folder.add(bind, 'pausa').name('Pausa fisica').listen();
    folder.add({ f: () => (window as any).__physicsDebug?.step() }, 'f').name('Passo singolo (1/120s)');
    folder.add(bind, 'cameraOrto').name('Camera ortogonale').listen();
    folder
      .add({ f: () => st().setDebugOrthoCameraAngleDeg((st().debugOrthoCameraAngleDeg + 90) % 360) }, 'f')
      .name("Ruota vista 90'");
    folder
      .add({ f: () => setBench({ rebuildNonce: bench().rebuildNonce + 1 }) }, 'f')
      .name('Ricostruisci ragdoll');
    folder
      .add({
        f: () => {
          const res = (window as any).__ragdollBench?.measureClips();
          (window as any).__ragdollBenchLastMeasure = res;
          if (res) {
            const rows: Record<string, string> = {};
            for (const [name, r] of Object.entries<any>(res.all)) {
              rows[name] = `X ${r.x[0].toFixed(0)}..${r.x[1].toFixed(0)} | Y ${r.y[0].toFixed(0)}..${r.y[1].toFixed(0)} | Z ${r.z[0].toFixed(0)}..${r.z[1].toFixed(0)}`;
            }
            console.table(rows);
          }
        },
      }, 'f')
      .name('Misura range animazioni');

    // L'elenco delle clip esiste solo dopo che il combattente del duello
    // e' montato: lo si riempie appena disponibile.
    const poll = window.setInterval(() => {
      const names: string[] | undefined = (window as any).__ragdollBench?.clipNames?.();
      if (names && names.length) {
        clipCtrl = clipCtrl.options([NO_CLIP, ...names]).name('Animazione di prova').listen();
        window.clearInterval(poll);
      }
    }, 1000);

    folder.close();
    return () => {
      window.clearInterval(poll);
      folder.destroy();
      releaseDebugGui();
    };
  }, []);

  return null;
};

export default RagdollBenchGUI;
