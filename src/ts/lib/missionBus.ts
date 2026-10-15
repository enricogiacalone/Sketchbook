// Le missioni della storia (Missions/StoryMission.tsx e HeistMission.tsx) si
// possono far ripartire da fuori (pannello Debug): StoryMission registra qui
// la funzione. id: 'ricetta' | 'ragioniere' | 'colpo'.
export const missionBus = {
  jump: null as null | ((id: string) => void),
};
