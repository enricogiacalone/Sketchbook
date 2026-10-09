import React, { useEffect, useState } from 'react';
import { useStore } from '../../store';
import type { ActiveRagdollSegmentDebug } from '../Environment/ragdoll/useRagdoll';

// "sistema l'ambiente per fare i test come si deve" -- tabella a schermo
// del banco di prova: per ogni corpo del ragdoll attivo quanto dista dal
// suo bersaglio animato (cm / gradi) e, per ogni giunto, l'angolo attuale
// per asse rispetto alla T-pose, quello chiesto dall'animazione e i
// limiti. Rosso = l'animazione chiede un angolo FUORI dai limiti del
// giunto (motore e limite si combattono) o il giunto e' oltre il limite.
const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(0).padStart(4, ' ');

const RagdollBenchOverlay: React.FC = () => {
  const show = useStore((s) => s.ragdollBench.showOverlay);
  const [rows, setRows] = useState<ActiveRagdollSegmentDebug[]>([]);

  useEffect(() => {
    if (!show || !import.meta.env.DEV) return;
    const id = window.setInterval(() => {
      const r = (window as any).__ragdollBench?.report?.();
      if (Array.isArray(r)) setRows(r);
    }, 150);
    return () => window.clearInterval(id);
  }, [show]);

  if (!show || !import.meta.env.DEV) return null;
  const maxPos = rows.reduce((m, r) => Math.max(m, r.posErrCm), 0);
  const meanAng = rows.length ? rows.reduce((m, r) => m + r.angErrDeg, 0) / rows.length : 0;

  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        top: 70,
        zIndex: 50,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.72)',
        color: '#ddd',
        font: '11px/1.35 ui-monospace, Menlo, monospace',
        padding: '6px 8px',
        borderRadius: 6,
        whiteSpace: 'pre',
        maxWidth: 'calc(100vw - 16px)',
        overflow: 'hidden',
      }}
    >
      <div style={{ color: '#fff', marginBottom: 4 }}>
        {`Ragdoll attivo  max err pos ${maxPos.toFixed(1)} cm  |  err ang medio ${meanAng.toFixed(1)}°`}
      </div>
      <div style={{ color: '#999' }}>{'segmento     pos cm  ang°  deb |  giunto X / Y / Z  attuale (anim) [limiti]'}</div>
      {rows.map((r) => {
        const j = r.joint;
        const bad = !!j && (j.targetOutside || j.atLimit);
        const warn = r.angErrDeg > 10 || r.posErrCm > 5;
        const color = bad ? '#ff5555' : warn ? '#ffd24d' : '#9f9';
        const jointTxt = j
          ? `X${fmt(j.cur[0])}(${fmt(j.target[0])})[${j.limits.x[0].toFixed(0)},${j.limits.x[1].toFixed(0)}] ` +
            `Y${fmt(j.cur[1])}(${fmt(j.target[1])})[${j.limits.y[0].toFixed(0)},${j.limits.y[1].toFixed(0)}] ` +
            `Z${fmt(j.cur[2])}(${fmt(j.target[2])})[${j.limits.z[0].toFixed(0)},${j.limits.z[1].toFixed(0)}]`
          : 'radice (servo bacino)';
        return (
          <div key={r.name} style={{ color }}>
            {`${r.name.padEnd(11, ' ')} ${r.posErrCm.toFixed(1).padStart(6, ' ')} ${r.angErrDeg.toFixed(1).padStart(5, ' ')} ${r.hitWeakness.toFixed(2)} |  ${jointTxt}`}
          </div>
        );
      })}
    </div>
  );
};

export default RagdollBenchOverlay;
