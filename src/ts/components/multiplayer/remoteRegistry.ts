// Armi dei giocatori remoti (NetworkMannequin.tsx): chi riceve uno sparo
// dalla rete (CityPlayer.tsx) fa rinculare e suonare l'arma giusta.
export interface RemoteGunFx {
  shot: (weapon: string) => void;
}
export const remoteGunFx = new Map<string, RemoteGunFx>();
