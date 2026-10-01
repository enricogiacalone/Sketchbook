// Collider che SPAZZANO (il rotore dell'arena): colpiscono chi e' in piedi
// (capsule solide -> KO) ma non toccano il corpo gia' a terra/KO. Un corpo
// KO preso dalla pala ci restava appoggiato sopra/davanti e veniva
// trascinato in tondo per secondi, schiacciato tra pala e pavimento: il
// solutore dei giunti esplodeva (misurato: 280 m/s, 2000 rad/s) -- le
// "capovolte strane tremando". Vedi il filtro in useRagdollActive.ts.
export const sweeperColliders = new Set<number>();
