// Brani delle casse dell'arena. Vite scopre da solo i file dentro
// musica/cassa-cubi e musica/cassa-schermo (radice del progetto): basta
// copiarceli, con `npm run dev` acceso la lista si aggiorna da sola (HMR).
// Cartella vuota -> brano di prova (public/audio-arena/music-demo, musica
// di Jason Shaw / audionautix.com, CC BY -- vedi public/audio-arena/CREDITS.txt).

export interface Track {
  url: string;
  name: string;
}

const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)$/i;

const cubiFiles = import.meta.glob('/musica/cassa-cubi/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const schermoFiles = import.meta.glob('/musica/cassa-schermo/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function toTracks(files: Record<string, string>): Track[] {
  return Object.keys(files)
    .filter((p) => AUDIO_EXT.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((p) => ({ url: files[p], name: p.split('/').pop()!.replace(AUDIO_EXT, '') }));
}

const DEMO_CUBI: Track = { url: '/audio-arena/music-demo/Ectoplasm.mp3', name: 'Ectoplasm (demo, audionautix.com)' };
const DEMO_SCHERMO: Track = { url: '/audio-arena/music-demo/AcousticRock.mp3', name: 'Acoustic Rock (demo, audionautix.com)' };

export type SpeakerId = 'cubi' | 'schermo';

export function getPlaylist(id: SpeakerId): { tracks: Track[]; isDemo: boolean } {
  const own = toTracks(id === 'cubi' ? cubiFiles : schermoFiles);
  if (own.length) return { tracks: own, isDemo: false };
  return { tracks: [id === 'cubi' ? DEMO_CUBI : DEMO_SCHERMO], isDemo: true };
}
