import React from 'react';
import { useStore } from '../../store';

const LoadingScreen: React.FC = () => {
  const { isLoading } = useStore();

  if (!isLoading) return null;

  return (
    <div id="loading-screen">
      <div id="loading-screen-background"></div>
      <h1 id="main-title" className="sb-font">Sketchbook AI</h1>
      <div id="loader">
        <div className="cubeWrap">
          <div className="cube">
            <div className="faces1"></div>
            <div className="faces2"></div>
          </div>
        </div>
      </div>
      <div id="loading-text" className="sb-font">Loading...</div>
    </div>
  );
};

export default LoadingScreen;
