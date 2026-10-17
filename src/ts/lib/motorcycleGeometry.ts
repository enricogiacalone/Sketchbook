// Geometria della moto: un solo posto per il modello (components/Vehicles/Motorcycle.tsx) e per lo
// script che disegna le animazioni del pilota (scripts/moto-rider-anim.mjs). Metri, nel sistema
// della moto: +Z avanti, +Y su, +X a sinistra, y = 0 sotto le ruote, origine a meta' interasse.
// Senza import: lo legge anche node (--experimental-strip-types).

export const MOTO = {
  wheelRadius: 0.33,
  wheelbase: 1.44,
  // centri ruota
  rearWheel: [0, 0.33, -0.72] as [number, number, number],
  frontWheel: [0, 0.33, 0.72] as [number, number, number],
  // cannotto di sterzo (inclinato all'indietro di `rake` gradi) e manubrio
  steerHead: [0, 1.0, 0.39] as [number, number, number],
  rakeDeg: 26,
  // la sella (punto piu' alto dove si siede il pilota): e' l'origine del pilota
  saddle: [0, 0.8, -0.22] as [number, number, number],
  // manopole del manubrio (sinistra = +x) e pedane
  gripL: [0.37, 1.1, 0.42] as [number, number, number],
  pegL: [0.23, 0.33, -0.1] as [number, number, number],
  // dove si sta in piedi per salire (a sinistra della sella)
  entrance: [0.95, 0, -0.22] as [number, number, number],
  length: 2.1,
  width: 0.8,
  massKg: 220,
};

// bersagli del pilota rispetto alla sella (destra = x specchiato)
export const RIDER = {
  hips: [0, 0.1, -0.04] as [number, number, number], // dove sta il bacino rispetto alla sella
  gripL: [MOTO.gripL[0] - MOTO.saddle[0], MOTO.gripL[1] - MOTO.saddle[1], MOTO.gripL[2] - MOTO.saddle[2]] as [number, number, number],
  pegL: [MOTO.pegL[0] - MOTO.saddle[0], MOTO.pegL[1] - MOTO.saddle[1], MOTO.pegL[2] - MOTO.saddle[2]] as [number, number, number],
  // a moto ferma il piede sinistro appoggia a terra (quota della sella sopra il suolo)
  groundBelowSaddle: -MOTO.saddle[1],
  // inclinazione in avanti del busto (gradi) in marcia
  leanForwardDeg: 16,
};
