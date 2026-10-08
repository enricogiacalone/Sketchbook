import { useEffect } from 'react';
import { useStore } from '../../store';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';

const CameraCalibrationGUI: React.FC = () => {
  useEffect(() => {
    // sezione comune "Personaggio e camera" del pannello Debug
    acquireDebugGui();
    const folder = debugSection('personaggio').addFolder('Camera (GTA IV)');
    const st = () => useStore.getState();
    const bind = {
      get playerRadius() {
        return st().cameraPlayerRadius;
      },
      set playerRadius(v: number) {
        st().setCameraPlayerRadius(v);
      },
      get vehicleRadius() {
        return st().cameraVehicleRadius;
      },
      set vehicleRadius(v: number) {
        st().setCameraVehicleRadius(v);
      },
      get footTargetY() {
        return st().cameraFootTargetY;
      },
      set footTargetY(v: number) {
        st().setCameraFootTargetY(v);
      },
      get vehicleTargetY() {
        return st().cameraVehicleTargetY;
      },
      set vehicleTargetY(v: number) {
        st().setCameraVehicleTargetY(v);
      },
    };
    folder.add(bind, 'playerRadius', 0.4, 3.0, 0.05).name('Distanza Player').listen();
    folder.add(bind, 'vehicleRadius', 1.0, 8.0, 0.1).name('Distanza Veicolo').listen();
    folder.add(bind, 'footTargetY', 0.0, 2.5, 0.05).name('Altezza Target Player').listen();
    folder.add(bind, 'vehicleTargetY', -1.0, 2.0, 0.05).name('Altezza Target Veicolo').listen();
    return () => {
      folder.destroy();
      releaseDebugGui();
    };
  }, []);
  return null;
};

export default CameraCalibrationGUI;
