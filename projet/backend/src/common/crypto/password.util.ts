import { randomBytes, scryptSync } from 'node:crypto';

// scrypt est un algorithme de hachage volontairement lent, recommandé pour
// les mots de passe (voir CLAUDE.md : "bcrypt, argon2 ou scrypt — jamais MD5
// ou SHA1"). On utilise ici le module `crypto` natif de Node : aucune
// dépendance supplémentaire, contrairement à bcrypt.
//
// Format stocké : "sel:hash" (deux valeurs hexadécimales séparées par ':').
// Le sel est différent à chaque hachage, donc deux utilisateurs avec le même
// mot de passe n'ont jamais le même passwordHash.
//
// La vérification (login) n'existe pas encore à cette étape : elle sera
// ajoutée avec l'authentification.

const KEY_LENGTH = 64;

export function hashPassword(plainPassword: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plainPassword, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}
