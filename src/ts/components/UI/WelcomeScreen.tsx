import React, { useState } from 'react';

interface WelcomeScreenProps {
  onJoin: (name: string, controlMethod: string) => void;
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
    onJoin(name.trim(), controlMethod);
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
        </form>
      </div>
    </div>
  );
};

export default WelcomeScreen;
