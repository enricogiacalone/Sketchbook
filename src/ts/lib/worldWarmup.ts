import { CITY_LAYOUT, getBuildingDetails } from '../components/Environment/City';
import { getStreetProps, getMarkings } from '../components/Environment/streetPropsData';
import { getFireEscapes } from '../components/Environment/fireEscapeData';
import { buildCityDetails } from '../components/Environment/CityDetails';
import { getMonumentLayout } from '../components/Environment/CityMonuments';

// "Scalda" i dati procedurali di una citta' appena generata, a pezzetti e A MONDO ANCORA
// SMONTATO (tra un frame e l'altro), cosi' quando i componenti si montano trovano gia' pronti
// arredo, segnaletica, scale antincendio, statue e dettagli dei palazzi: senza, il primo
// montaggio calcolava tutto in un colpo solo e congelava il gioco per piu' di un secondo.
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const step = async (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    console.warn('warmup', e);
  }
  await nextFrame();
};

export async function warmWorld() {
  await step(getStreetProps);
  await step(getMarkings);
  await step(getFireEscapes);
  await step(buildCityDetails);
  await step(getMonumentLayout);
  const n = CITY_LAYOUT.buildings.length;
  for (let i = 0; i < n; i += 10) {
    await step(() => {
      for (let k = i; k < Math.min(n, i + 10); k++) getBuildingDetails(k);
    });
  }
}
