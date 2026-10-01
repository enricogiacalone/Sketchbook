// Ponte camera -> minimappa (UI/Minimap.tsx, fuori dal Canvas): in GTA il
// radar ruota con la CAMERA (in alto c'e' dove guardi), non con il
// personaggio. Scritto ogni frame da RadarCameraBridge (dentro il Canvas).
export const radarState = {
  // direzione della camera sul piano, in senso orario dal nord (-Z), rad
  camHeading: 0,
  valid: false,
};
