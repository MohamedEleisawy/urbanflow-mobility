import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt est un algorithme de hachage volontairement lent, recommandé pour
// les mots de passe (voir CLAUDE.md : "bcrypt, argon2 ou scrypt — jamais MD5
// ou SHA1"). On utilise ici le module `crypto` natif de Node : aucune
// dépendance supplémentaire, contrairement à bcrypt.
//
// Format stocké : "sel:hash" (deux valeurs hexadécimales séparées par ':').
// Le sel est différent à chaque hachage, donc deux utilisateurs avec le même
// mot de passe n'ont jamais le même passwordHash.

const KEY_LENGTH = 64;

export function hashPassword(plainPassword: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plainPassword, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

// Utilisée par AuthService au moment du login. On recalcule le hash avec le
// même sel que celui stocké, puis on compare en temps constant
// (timingSafeEqual) plutôt qu'avec "===", pour ne pas laisser un attaquant
// déduire des informations à partir du temps de comparaison.
export function verifyPassword(
  plainPassword: string,
  storedHash: string,
): boolean {
  const [salt, hash] = storedHash.split(':');
  const hashToVerify = scryptSync(plainPassword, salt, KEY_LENGTH).toString(
    'hex',
  );
  return timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(hashToVerify, 'hex'),
  );
}
