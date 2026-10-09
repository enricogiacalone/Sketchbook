// Collider che SPAZZANO (il rotore dell'arena): colpiscono chi e' in piedi
// e spingono di lato i pezzi del corpo KO che hanno davanti, ma passano
// SOTTO quelli che stanno sopra la pala. Un corpo KO che finiva sopra una
// pala ci restava appoggiato e veniva trascinato in tondo per secondi,
// schiacciato tra pala e pavimento: il solutore dei giunti esplodeva
// (misurato: 280 m/s, 2000 rad/s) -- le "capovolte strane tremando".
// Vedi il filtro dei contatti in useRagdollActive.ts.
export const sweeperColliders = new Set<number>();
