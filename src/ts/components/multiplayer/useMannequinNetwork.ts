import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { toInt16 } from './mannequinPose';
import type { MannequinExt, NetHit, NetShot, Quat, Vec3 } from './netTypes';

// Rete del manichino (sostituisce useNetwork.ts del boxman). Differenze:
// - si invia a 20 Hz da un timer, leggendo lo stato con `sample()`: niente
//   setState ogni frame nel componente del giocatore;
// - i giocatori remoti stanno in un ref (letto da useFrame): React si
//   ri-renderizza solo quando qualcuno entra o esce, non 20 volte al secondo;
// - ogni aggiornamento porta la posa dello scheletro (mannequinPose.ts) e lo
//   stato di gioco (netTypes.ts: vita, arma, auto, drone);
// - eventi a parte, subito: colpi tra giocatori ('hit') e spari ('shot').

export interface OutgoingState {
  position: { x: number; y: number; z: number };
  quaternion: Quat;
  animation: string;
  model: 'mannequin';
  weapon: string;
  pose: ArrayBuffer;
  ext: MannequinExt;
}

export interface RemoteMannequin {
  id: string;
  name: string;
  color: string;
  pos: Vec3;
  quat: Quat;
  animation: string;
  weapon: string;
  pose: Int16Array | null;
  // cresce a ogni posa ricevuta (chi la applica sa se e' nuova)
  seq: number;
  ext: MannequinExt | null;
  // performance.now() dell'ultimo pacchetto
  at: number;
}

const SEND_MS = 50;

export function useMannequinNetwork(
  userName: string,
  sample: () => OutgoingState | null,
  handlers: { onHit?: (hit: NetHit) => void; onShot?: (shot: NetShot) => void } = {}
) {
  const remotesRef = useRef(new Map<string, RemoteMannequin>());
  const [ids, setIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const socketRef = useRef<Socket | null>(null);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const s = io(`${window.location.protocol}//${window.location.hostname}:3000/update`);
    socketRef.current = s;
    if (import.meta.env.DEV) (window as any).__mpNet = { socket: s, remotes: remotesRef.current };
    const msgTimers = new Map<string, ReturnType<typeof setTimeout>>();

    s.on('connect', () => s.emit('joinGame', userName));

    s.on('playerData', (players: any[]) => {
      const map = remotesRef.current;
      const seen = new Set<string>();
      const now = performance.now();
      for (const p of players) {
        if (!p || p.id === s.id) continue;
        seen.add(p.id);
        let r = map.get(p.id);
        if (!r) {
          r = {
            id: p.id,
            name: p.name ?? '',
            color: p.color ?? '#ffffff',
            pos: [0, 0, 0],
            quat: [0, 0, 0, 1],
            animation: '',
            weapon: 'fists',
            pose: null,
            seq: 0,
            ext: null,
            at: now,
          };
          map.set(p.id, r);
        }
        r.name = p.name ?? r.name;
        r.color = p.color ?? r.color;
        r.pos[0] = p.position_x;
        r.pos[1] = p.position_y;
        r.pos[2] = p.position_z;
        r.quat[0] = p.quaternion_x;
        r.quat[1] = p.quaternion_y;
        r.quat[2] = p.quaternion_z;
        r.quat[3] = p.quaternion_w;
        r.animation = p.animation ?? '';
        r.weapon = p.weapon ?? 'fists';
        r.ext = p.ext ?? null;
        r.at = now;
        const pose = toInt16(p.pose);
        if (pose) {
          r.pose = pose;
          r.seq++;
        }
      }
      for (const id of Array.from(map.keys())) if (!seen.has(id)) map.delete(id);
      const next = Array.from(map.keys()).sort();
      setIds((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    });

    s.on('hit', (hit: NetHit) => handlersRef.current.onHit?.(hit));
    s.on('shot', (shot: NetShot) => handlersRef.current.onShot?.(shot));

    s.on('chatMessage', (d: { senderId: string; message: string }) => {
      setMessages((m) => ({ ...m, [d.senderId]: d.message }));
      const old = msgTimers.get(d.senderId);
      if (old) clearTimeout(old);
      msgTimers.set(
        d.senderId,
        setTimeout(() => setMessages((m) => ({ ...m, [d.senderId]: '' })), 5000)
      );
    });

    const timer = setInterval(() => {
      if (!s.connected) return;
      const out = sampleRef.current();
      if (out) s.emit('updatePlayer', out);
    }, SEND_MS);

    return () => {
      clearInterval(timer);
      msgTimers.forEach((t) => clearTimeout(t));
      s.disconnect();
      socketRef.current = null;
      remotesRef.current.clear();
    };
  }, [userName]);

  const sendChat = useCallback((message: string) => {
    const s = socketRef.current;
    if (s && s.connected && message) s.emit('chatMessage', { message });
  }, []);
  const sendHit = useCallback((hit: NetHit) => {
    const s = socketRef.current;
    if (s && s.connected) s.emit('hit', hit);
  }, []);
  const sendShot = useCallback((shot: NetShot) => {
    const s = socketRef.current;
    if (s && s.connected) s.emit('shot', shot);
  }, []);

  return { remotesRef, ids, messages, sendChat, sendHit, sendShot };
}
