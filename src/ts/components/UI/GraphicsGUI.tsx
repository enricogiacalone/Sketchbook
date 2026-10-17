import { useEffect } from 'react';
import { useStore } from '../../store';
import { acquireDebugGui, debugSection, releaseDebugGui } from '../../lib/debugGui';
import { skySettings } from '../../lib/space';
import { adaptiveResInfo } from '../Environment/AdaptiveResolution';

const GraphicsGUI: React.FC = () => {
  useEffect(() => {
    acquireDebugGui();
    const folder = debugSection('grafica');
    const st = () => useStore.getState();
    const bind = {
      get toon() {
        return st().toonStyle;
      },
      set toon(v: boolean) {
        st().setToonStyle(v);
      },
      get skyShader() {
        return skySettings.shader;
      },
      set skyShader(v: boolean) {
        skySettings.shader = v;
      },
      get giornata() {
        return st().dayCycle;
      },
      set giornata(v: boolean) {
        st().setDayCycle(v);
      },
      get zombi() {
        return st().zombieNight;
      },
      set zombi(v: boolean) {
        st().setZombieNight(v);
      },
      get adattiva() {
        return st().adaptiveResolution;
      },
      set adattiva(v: boolean) {
        st().setAdaptiveResolution(v);
      },
      get collectibles() {
        return st().showCollectiblesCounter;
      },
      set collectibles(v: boolean) {
        st().setShowCollectiblesCounter(v);
      },
      get controls() {
        return st().showControls;
      },
      set controls(v: boolean) {
        st().setShowControls(v);
      },
      get chat() {
        return st().showChatInput;
      },
      set chat(v: boolean) {
        st().setShowChatInput(v);
      },
      get gamepadDebug() {
        return st().showGamepadDebug;
      },
      set gamepadDebug(v: boolean) {
        st().setShowGamepadDebug(v);
      },
      get statusBars() {
        return st().showStatusBars;
      },
      set statusBars(v: boolean) {
        st().setShowStatusBars(v);
      },
      get npcChat() {
        return st().showNpcChat;
      },
      set npcChat(v: boolean) {
        st().setShowNpcChat(v);
      },
    };
    const ctrls = [
      folder.add(bind, 'toon').name('Stile toon').listen(),
      folder.add(bind, 'skyShader').name('Shader del cielo').listen(),
      folder.add(bind, 'giornata').name('Scorre la giornata (giorno/notte)').listen(),
      folder.add(bind, 'zombi').name('Modalità zombi notturna').listen(),
      folder.add(bind, 'adattiva').name('Risoluzione adattiva').listen(),
      folder.add(adaptiveResInfo, 'dpr').name('  risoluzione (dpr)').listen().disable(),
      folder.add(adaptiveResInfo, 'fps').name('  fps').listen().disable(),
      folder.add(bind, 'collectibles').name('HUD: Contatore Collezionabili').listen(),
      folder.add(bind, 'controls').name('HUD: Controlli').listen(),
      folder.add(bind, 'chat').name('HUD: Chat di Gioco').listen(),
      folder.add(bind, 'gamepadDebug').name('HUD: Debug Gamepad').listen(),
      folder.add(bind, 'statusBars').name('HUD: Barre di Stato').listen(),
      folder.add(bind, 'npcChat').name('HUD: Chat Passanti NPC').listen(),
    ];
    return () => {
      ctrls.forEach((c) => c.destroy());
      releaseDebugGui();
    };
  }, []);
  return null;
};

export default GraphicsGUI;
