import { randomInt } from "node:crypto";

// Sans 0/O ni 1/l/I (ambigus à l'oral/à l'écrit) — donné de vive voix ou
// par écrit, à changer à la première connexion.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateProvisionalPassword(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
