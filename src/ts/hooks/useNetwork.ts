import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface NetworkPlayerData {
  id: string;
  name: string;
  color: string;
  position_x: number;
  position_y: number;
  position_z: number;
  quaternion_x: number;
  quaternion_y: number;
  quaternion_z: number;
  quaternion_w: number;
  animation: string;
  lastMessage?: string;
}

export const useNetwork = (
  userName: string, 
  playerPosition: [number, number, number], 
  playerQuaternion: number[], 
  playerAnimation: string
) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<Map<string, NetworkPlayerData>>(new Map());
  const [myId, setMyId] = useState<string | null>(null);
  const messageTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    // Use the current origin for the socket connection
    const s = io(`${window.location.protocol}//${window.location.hostname}:3000/update`);
    setSocket(s);

    s.on('connect', () => {
      console.log('Connected to server, joining as:', userName);
      s.emit('joinGame', userName);
    });

    s.on('setID', (id: string) => {
      setMyId(id);
    });

    s.on('playerData', (players: NetworkPlayerData[]) => {
      setRemotePlayers((prev) => {
        const newMap = new Map(prev);
        
        // Remove players who are no longer connected
        const currentIds = players.map(p => p.id);
        Array.from(newMap.keys()).forEach(id => {
            if (!currentIds.includes(id) && id !== s.id) {
                newMap.delete(id);
            }
        });

        players.forEach((p) => {
          if (p.id !== s.id) {
            const existing = newMap.get(p.id);
            newMap.set(p.id, {
                ...p,
                // Preserve the last message if it hasn't expired yet
                lastMessage: existing?.lastMessage 
            });
          }
        });
        return newMap;
      });
    });

    s.on('chatMessage', (data: { senderId: string, message: string }) => {
        setRemotePlayers((prev) => {
            const newMap = new Map(prev);
            const player = newMap.get(data.senderId);
            if (player) {
                newMap.set(data.senderId, { ...player, lastMessage: data.message });
                
                // Clear existing timeout for this player
                if (messageTimeouts.current.has(data.senderId)) {
                    clearTimeout(messageTimeouts.current.get(data.senderId)!);
                }

                // Set a new timeout to clear the message after 5 seconds
                const timeout = setTimeout(() => {
                    setRemotePlayers(currentMap => {
                        const updatedMap = new Map(currentMap);
                        const p = updatedMap.get(data.senderId);
                        if (p) updatedMap.set(data.senderId, { ...p, lastMessage: '' });
                        return updatedMap;
                    });
                }, 5000);

                messageTimeouts.current.set(data.senderId, timeout);
            }
            return newMap;
        });
    });

    return () => {
      s.disconnect();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      messageTimeouts.current.forEach(t => clearTimeout(t));
    };
  }, [userName]);

  // playerPosition/playerQuaternion are new array literals every single
  // render (Player.tsx/Car.tsx/etc. build them fresh each frame), so this
  // effect used to fire -- and emit over the socket -- every single frame,
  // regardless of whether anything actually moved. The server only
  // rebroadcasts every 50ms anyway (see server.js), so anything faster than
  // that is pure waste; this throttles to that same cadence and skips the
  // emit entirely when the position/rotation barely changed (e.g. a parked
  // car, an idle player).
  const lastEmitRef = useRef<{ time: number; pos: [number, number, number]; quat: number[] } | null>(null);
  useEffect(() => {
    if (socket && socket.connected) {
      const now = performance.now();
      const last = lastEmitRef.current;

      const dx = playerPosition[0] - (last?.pos[0] ?? Infinity);
      const dy = playerPosition[1] - (last?.pos[1] ?? Infinity);
      const dz = playerPosition[2] - (last?.pos[2] ?? Infinity);
      const posDeltaSq = dx * dx + dy * dy + dz * dz;

      let quatDeltaSq = 0;
      if (last) {
        for (let i = 0; i < playerQuaternion.length; i++) {
          const d = playerQuaternion[i] - (last.quat[i] ?? 0);
          quatDeltaSq += d * d;
        }
      } else {
        quatDeltaSq = Infinity;
      }

      const EMIT_INTERVAL_MS = 50;
      const POS_EPSILON_SQ = 0.0001; // 0.01 units
      const QUAT_EPSILON_SQ = 0.000001;

      const enoughTimePassed = !last || now - last.time >= EMIT_INTERVAL_MS;
      const movedEnough = posDeltaSq > POS_EPSILON_SQ || quatDeltaSq > QUAT_EPSILON_SQ;

      if (enoughTimePassed && movedEnough) {
        socket.emit('updatePlayer', {
          position: { x: playerPosition[0], y: playerPosition[1], z: playerPosition[2] },
          quaternion: playerQuaternion,
          animation: playerAnimation,
        });
        lastEmitRef.current = { time: now, pos: playerPosition, quat: playerQuaternion };
      }
    }
  }, [socket, playerPosition, playerQuaternion, playerAnimation]);

  const sendChatMessage = (message: string) => {
    if (socket && socket.connected) {
        socket.emit('chatMessage', { message });
    }
  };

  return { remotePlayers, myId, sendChatMessage };
};
