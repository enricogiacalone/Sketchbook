// node --import ./training/fly-brain/register.mjs ... : permette a Node di
// importare i moduli TypeScript del gioco scritti senza estensione
// ("./ragdollData" -> "./ragdollData.ts"). Il TypeScript lo toglie Node
// da solo (type stripping, Node >= 22.18).
import { register } from 'node:module';
register('./resolve-ts.mjs', import.meta.url);
