import { askOllama, ollamaEnabled } from '../../lib/ollamaNpc';
import React, { useState, useEffect } from 'react';
import { useStore } from '../../store';

// "Parla con un passante": chat interattiva con Ollama quando sei vicino a un NPC in citta'.
const NpcChatOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ sender: 'player' | 'npc'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [npcName, setNpcName] = useState('Passante di Sketchbook');

  // Listen for 'KeyE' interaction or show button when near
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' && !isOpen) {
        // Toggle chat with nearest NPC or general NPC
        setIsOpen(true);
        if (messages.length === 0) {
          setMessages([{ sender: 'npc', text: "Ehilà! Che si dice in giro per la città?" }]);
        }
        e.preventDefault();
      } else if (e.code === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { sender: 'player', text: userMsg }]);
    setLoading(true);

    try {
      const prompt = `Passante ironico in un gioco 3D open-world. Rispondi in italiano, breve, alla battuta del giocatore: "${userMsg}"`;
      const reply = (await askOllama(prompt, 'chat', 64)) ?? (ollamaEnabled() ? 'Non so che dire, amico!' : 'La chat con gli NPC e\' spenta (si attiva dalla schermata iniziale).');

      setMessages((prev) => [...prev, { sender: 'npc', text: reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { sender: 'npc', text: "Hmm... il mio cervello Ollama si è disconnesso un attimo." }]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <div style={{
        position: 'absolute',
        bottom: 25,
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
        zIndex: 100
      }}>
        <button
          onClick={() => {
            setIsOpen(true);
            if (messages.length === 0) {
              setMessages([{ sender: 'npc', text: "Ehilà! Che si dice in giro per la città?" }]);
            }
          }}
          style={{
            background: '#0f172a',
            color: '#38bdf8',
            border: '2px solid #38bdf8',
            borderRadius: 8,
            padding: '8px 16px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: 13,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
          }}
        >
          💬 Premi 'E' o Clicca per Parlare con un Passante (Ollama AI)
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 25,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 420,
      background: 'rgba(15, 23, 42, 0.95)',
      border: '2px solid #38bdf8',
      borderRadius: 12,
      padding: 16,
      zIndex: 200,
      fontFamily: 'monospace',
      boxShadow: '0 10px 30px rgba(0,0,0,0.7)',
      color: '#fff'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid #334155', paddingBottom: 6 }}>
        <div style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: 14 }}>🗣 Conversazione con: {npcName}</div>
        <button
          onClick={() => setIsOpen(false)}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, fontWeight: 'bold' }}
        >
          ✕
        </button>
      </div>

      <div style={{
        height: 180,
        overflowY: 'auto',
        background: 'rgba(30, 41, 59, 0.5)',
        borderRadius: 8,
        padding: 10,
        marginBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}>
        {messages.map((m, idx) => (
          <div key={idx} style={{
            alignSelf: m.sender === 'player' ? 'flex-end' : 'flex-start',
            background: m.sender === 'player' ? '#0369a1' : '#334155',
            padding: '6px 10px',
            borderRadius: 8,
            maxWidth: '80%',
            fontSize: 12,
            lineHeight: 1.4
          }}>
            <span style={{ fontWeight: 'bold', display: 'block', fontSize: 10, color: m.sender === 'player' ? '#7dd3fc' : '#cbd5e1', marginBottom: 2 }}>
              {m.sender === 'player' ? 'Tu' : npcName}
            </span>
            {m.text}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>
            Il passante sta pensando...
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Scrivi cosa dire al passante..."
          style={{
            flex: 1,
            background: '#1e293b',
            border: '1px solid #475569',
            borderRadius: 6,
            padding: '8px 10px',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 12
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            background: '#0284c7',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 14px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: 12
          }}
        >
          Invia
        </button>
      </form>
    </div>
  );
};

export default NpcChatOverlay;
