import React, { useState } from 'react';
import { useStore } from '../../store';

interface WelcomeScreenProps {
  // "crea una sezione dedicata nel menu di avvio del gioco che mi fa
  // entrare in un'arena" -- the third arg picks which world you land in:
  // 'world' is the existing "Enter Playground" flow, 'duel' drops you
  // straight into the 1v1 arena (see App.tsx's handleJoin).
  onJoin: (name: string, controlMethod: string, mode: 'world' | 'duel' | 'flylab') => void;
}

const checkRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontSize: 14,
  margin: '6px 0',
};

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onJoin }) => {
  // "aggiungi un nome precompilato nella login del gioco cosi' non devo
  // metterla a mano ogni volta" -- pre-filled rather than starting empty;
  // still a normal editable input (and still validated on submit below),
  // just no longer something you have to type from scratch every single
  // time you reload to test.
  const [name, setName] = useState('Enrico');
  const [controlMethod, setControlMethod] = useState('keyboard');
  const toonStyle = useStore((st) => st.toonStyle);
  const setToonStyle = useStore((st) => st.setToonStyle);
  const dayCycle = useStore((st) => st.dayCycle);
  const setDayCycle = useStore((st) => st.setDayCycle);
  const [error, setError] = useState('');
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneUrl, setPhoneUrl] = useState('');

  const handleOpenPhoneController = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const url = `http://${data.ip}:${data.port}/controller`;
      setPhoneUrl(url);
      setShowPhoneModal(true);
    } catch (e) {
      console.error('Failed to fetch config', e);
      const url = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3000'}/controller`;
      setPhoneUrl(url);
      setShowPhoneModal(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name!');
      return;
    }
    onJoin(name.trim(), controlMethod, 'world');
  };

  const handleDuelClick = () => {
    if (!name.trim()) {
      setError('Please enter your name!');
      return;
    }
    onJoin(name.trim(), controlMethod, 'duel');
  };

  return (
    <div className="welcome-overlay">
      <div className="welcome-bg-glow" />
      <div className="welcome-bg-glow-2" />

      <div className="welcome-card">
        <h1 className="welcome-title">Sketchbook</h1>
        <p className="welcome-subtitle">
          Step into a physics-based 3D playground. Explore the city, spawn meteorites, and drive multiple vehicles!
        </p>

        <form onSubmit={handleSubmit}>
          <div className="welcome-form-group">
            <label className="welcome-label" htmlFor="name-input">
              Your Username
            </label>
            <input
              id="name-input"
              className="welcome-input"
              type="text"
              placeholder="Enter your name..."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError('');
              }}
              autoFocus
              maxLength={15}
            />
            {error && <span className="welcome-error-msg">{error}</span>}
          </div>

          <div className="welcome-form-group">
            <label className="welcome-label">Control Mode</label>
            <div className="welcome-options">
              <div
                className={`welcome-option-card ${controlMethod === 'keyboard' ? 'active' : ''}`}
                onClick={() => setControlMethod('keyboard')}
              >
                <span className="welcome-option-icon">⌨️</span>
                <span className="welcome-option-title">Keyboard & Mouse</span>
              </div>
              <div
                className={`welcome-option-card ${controlMethod === 'gamepad' ? 'active' : ''}`}
                onClick={() => setControlMethod('gamepad')}
              >
                <span className="welcome-option-icon">🎮</span>
                <span className="welcome-option-title">Gamepad</span>
              </div>
            </div>
          </div>

          <div className="welcome-form-group">
            <label className="welcome-label">Grafica</label>
            <label style={checkRow}>
              <input type="checkbox" checked={toonStyle} onChange={(e) => setToonStyle(e.target.checked)} /> Stile toon
            </label>
            <label style={checkRow}>
              <input type="checkbox" checked={dayCycle} onChange={(e) => setDayCycle(e.target.checked)} /> Scorre la giornata (giorno e
              notte) &mdash; spento: sempre giorno
            </label>
          </div>

          <button className="welcome-button" type="submit">
            Enter Playground 🚀
          </button>

          {/* "siamo io che controllo un combat soldier contro un altro
              combat soldier" -- a dedicated entry point straight into the
              1v1 duel arena, alongside (not instead of) the normal city. */}
          <button className="welcome-button welcome-button-duel" type="button" onClick={handleDuelClick}>
            ⚔️ Duello 1v1
          </button>

          {/* "una terza sezione del menu principale per fare il training
              alla mosca" -- laboratorio minimale (src/ts/flyLab). */}
          <button
            className="welcome-button welcome-button-fly"
            type="button"
            onClick={() => onJoin(name.trim() || 'Ricercatore', controlMethod, 'flylab')}
          >
            🪰 Laboratorio cervello mosca
          </button>

          <button
            className="welcome-button"
            style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', marginTop: 12 }}
            type="button"
            onClick={handleOpenPhoneController}
          >
            📱 Usa Smartphone come Joystick
          </button>
        </form>
      </div>

      {showPhoneModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999999,
          }}
        >
          <div className="welcome-card" style={{ maxWidth: 380, textAlign: 'center' }}>
            <h2 style={{ fontSize: 22, marginBottom: 12, color: '#a5b4fc' }}>Joystick Smartphone</h2>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
              Inquadra il QR code con la fotocamera del telefono (stessa rete Wi-Fi) per usarlo come controller.
            </p>
            <div style={{ background: '#fff', padding: 12, borderRadius: 12, display: 'inline-block', marginBottom: 16 }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(phoneUrl)}`}
                alt="QR Code Controller"
                style={{ width: 180, height: 180, display: 'block' }}
              />
            </div>
            <div
              style={{
                marginBottom: 20,
                wordBreak: 'break-all',
                fontSize: 12,
                background: 'rgba(255,255,255,0.05)',
                padding: 8,
                borderRadius: 6,
              }}
            >
              <a href={phoneUrl} target="_blank" rel="noreferrer" style={{ color: '#818cf8', textDecoration: 'none' }}>
                {phoneUrl}
              </a>
            </div>
            <button className="welcome-button" type="button" onClick={() => setShowPhoneModal(false)}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WelcomeScreen;
