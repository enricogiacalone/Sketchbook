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

  useEffect(() => {
    if (socket && socket.connected) {
      socket.emit('updatePlayer', {
        position: { x: playerPosition[0], y: playerPosition[1], z: playerPosition[2] },
        quaternion: playerQuaternion,
        animation: playerAnimation,
      });
    }
  }, [socket, playerPosition, playerQuaternion, playerAnimation]);

  const sendChatMessage = (message: string) => {
    if (socket && socket.connected) {
        socket.emit('chatMessage', { message });
    }
  };

  return { remotePlayers, myId, sendChatMessage };
};
