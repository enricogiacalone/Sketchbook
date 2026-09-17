import React, { useState } from 'react';

interface WelcomeScreenProps {
  // "crea una sezione dedicata nel menu di avvio del gioco che mi fa
  // entrare in un'arena" -- the third arg picks which world you land in:
  // 'world' is the existing "Enter Playground" flow, 'duel' drops you
  // straight into the 1v1 arena (see App.tsx's handleJoin).
  onJoin: (name: string, controlMethod: string, mode: 'world' | 'duel') => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onJoin }) => {
  const [name, setName] = useState('');
  const [controlMethod, setControlMethod] = useState('keyboard');
  const [error, setError] = useState('');

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

          <button className="welcome-button" type="submit">
            Enter Playground 🚀
          </button>

          {/* "siamo io che controllo un combat soldier contro un altro
              combat soldier" -- a dedicated entry point straight into the
              1v1 duel arena, alongside (not instead of) the normal city. */}
          <button className="welcome-button welcome-button-duel" type="button" onClick={handleDuelClick}>
            ⚔️ Duello 1v1
          </button>
        </form>
      </div>
    </div>
  );
};

export default WelcomeScreen;
