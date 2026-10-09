// "se clicco su un npc mi dice quale animazione sta effettuando":
// ispettore dei personaggi. Tasto I: il mouse si libera (niente colpi,
// niente telecamera) e un clic sceglie il personaggio piu' vicino al
// raggio del mouse tra quelli iscritti in lib/npcInspect.ts (corpi veri e
// sagome della folla). Il riquadro dice, aggiornato dal vivo, quali
// animazioni stanno girando (peso, tempo, velocita'), lo stato e il
// comportamento; una freccia gialla indica chi e'. I di nuovo per uscire.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { inspectables, type InspectInfo } from '../../lib/npcInspect';
import { crowdAgents } from '../city/crowdSim';

const UPDATE_S = 0.12;
const _ray = new THREE.Ray();
const _ndc = new THREE.Vector2();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _pRay = new THREE.Vector3();
const _pSeg = new THREE.Vector3();
const _where = { x: 0, y: 0, z: 0, h: 0 };

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function render(info: InspectInfo | null, id: string | null, visible: boolean): string {
  const head = '<b>Ispettore NPC</b> <span style="opacity:.6">(I per uscire)</span>';
  if (!info || !id) return `${head}<br><span style="opacity:.8">Clicca un personaggio.</span>`;
  let h = `${head}<br><b style="color:#ffd54f">${esc(info.title)}</b>${visible ? '' : ' <i>(non visibile ora)</i>'}`;
  if (info.anims) {
    h += '<br><b>animazioni in corso</b>';
    if (!info.anims.length) h += '<br>&nbsp; nessuna';
    for (const a of info.anims) {
      const pct = a.duration > 0 ? (a.time / a.duration) * 100 : 0;
      h += `<br>&nbsp; <b>${esc(a.clip)}</b> peso ${(a.weight * 100).toFixed(0)}%, ${a.time.toFixed(2)}/${a.duration.toFixed(2)} s (${pct.toFixed(0)}%), x${a.timeScale.toFixed(2)}${a.loop ? '' : ', una volta'}`;
    }
  }
  for (const [k, v] of info.rows) h += `<br><span style="opacity:.7">${esc(k)}:</span> ${esc(v)}`;
  return h;
}

export default function NpcInspector() {
  const { camera, gl, scene } = useThree();
  const on = useStore((s) => s.npcInspector);
  const selRef = useRef<string | null>(null);
  const accRef = useRef(UPDATE_S);
  // ultimo agente della folla visto nel corpo vero scelto (per tornare alla sua sagoma)
  const lastAgentRef = useRef<number | null>(null);
  const panel = useMemo(() => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed',
      top: '64px',
      left: '12px',
      maxWidth: '460px',
      padding: '8px 10px',
      background: 'rgba(10,12,16,0.82)',
      color: '#fff',
      font: '12px/1.45 ui-monospace, Menlo, monospace',
      borderRadius: '6px',
      zIndex: '50',
      pointerEvents: 'none',
      display: 'none',
    });
    return d;
  }, []);
  const marker = useMemo(() => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 12), new THREE.MeshBasicMaterial({ color: '#ffd54f', depthTest: false }));
    m.rotation.x = Math.PI; // punta in giu'
    m.renderOrder = 999;
    m.visible = false;
    return m;
  }, []);

  useEffect(() => {
    document.body.appendChild(panel);
    scene.add(marker);
    return () => {
      panel.remove();
      scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    };
  }, [panel, marker, scene]);

  // tasto I
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyI' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = useStore.getState();
      st.setNpcInspector(!st.npcInspector);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    panel.style.display = on ? 'block' : 'none';
    if (on) {
      if (document.pointerLockElement) document.exitPointerLock();
      panel.innerHTML = render(null, null, false);
    } else {
      selRef.current = null;
      marker.visible = false;
    }
  }, [on, panel, marker]);

  // clic: il personaggio piu' vicino al raggio del mouse
  useEffect(() => {
    if (!on) return;
    const el = gl.domElement;
    const onClick = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      _ray.origin.setFromMatrixPosition(camera.matrixWorld);
      _ray.direction.set(_ndc.x, _ndc.y, 0.5).unproject(camera).sub(_ray.origin).normalize();
      let best: string | null = null;
      let bestT = Infinity;
      for (const [id, it] of inspectables) {
        if (!it.where(_where)) continue;
        _a.set(_where.x, _where.y, _where.z);
        _b.set(_where.x, _where.y + _where.h, _where.z);
        const d2 = _ray.distanceSqToSegment(_a, _b, _pRay, _pSeg);
        const t = _pRay.distanceTo(_ray.origin);
        if (t < 0.3) continue; // dietro la telecamera
        // tolleranza che cresce con la distanza (un passante lontano e' piccolo)
        const tol = 0.45 + t * 0.012;
        if (d2 < tol * tol && t < bestT) {
          bestT = t;
          best = id;
        }
      }
      selRef.current = best;
      accRef.current = UPDATE_S;
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [on, gl, camera]);

  useFrame((_s, dt) => {
    if (!on) return;
    let id = selRef.current;
    if (!id) {
      marker.visible = false;
      return;
    }
    let it = inspectables.get(id);
    let visible = !!it && it.where(_where);
    // un passante della folla passa da sagoma a corpo vero e viceversa:
    // l'ispettore lo segue
    if (!visible) {
      const ag = id.startsWith('crowd-agent-') ? crowdAgents.find((a) => `crowd-agent-${a.id}` === id) : null;
      if (ag && ag.slot >= 0) id = `crowd-slot-${ag.slot}`;
      else if (id.startsWith('crowd-slot-')) {
        const slot = Number(id.slice('crowd-slot-'.length));
        const ag2 = crowdAgents.find((a) => a.slot === slot) ?? null;
        if (!ag2) {
          // il corpo e' stato restituito: torna alla sagoma dell'ultimo agente
          if (lastAgentRef.current !== null) id = `crowd-agent-${lastAgentRef.current}`;
        }
      }
      if (id !== selRef.current) {
        selRef.current = id;
        it = inspectables.get(id);
        visible = !!it && it.where(_where);
      }
    }
    if (id.startsWith('crowd-slot-')) {
      const slot = Number(id.slice('crowd-slot-'.length));
      const ag = crowdAgents.find((a) => a.slot === slot);
      if (ag) lastAgentRef.current = ag.id;
    }
    if (visible) {
      marker.visible = true;
      marker.position.set(_where.x, _where.y + _where.h + 0.35, _where.z);
      // da lontano resta visibile
      marker.scale.setScalar(Math.max(1, marker.position.distanceTo(camera.position) / 12));
    } else marker.visible = false;
    accRef.current += dt;
    if (accRef.current < UPDATE_S) return;
    accRef.current = 0;
    panel.innerHTML = render(it ? it.info() : null, it ? id : null, visible);
  });

  return null;
}
