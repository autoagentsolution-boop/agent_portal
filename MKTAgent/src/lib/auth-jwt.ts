// Long-lived JWT (HS256) for app sessions. No refresh token by design — the user
// wants zero re-auth friction (plan T1/§4). Token carries the userId as `sub`;
// on expiry or JWT_SECRET rotation the user simply re-logs-in via Google.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';

export interface JwtClaims {
  sub: string; // userId
  email: string;
}

const requireSecret = (): string => {
  if (!env.JWT_SECRET) throw new Error('auth: JWT_SECRET not set');
  return env.JWT_SECRET;
};

export const signSession = (claims: JwtClaims): string =>
  jwt.sign(claims, requireSecret(), {
    algorithm: 'HS256',
    expiresIn: env.JWT_TTL as jwt.SignOptions['expiresIn'],
  });

// Returns claims on a valid, unexpired token; null on any failure (bad sig,
// expired, malformed). Callers map null → 401; never leak the reason.
export const verifySession = (token: string): JwtClaims | null => {
  try {
    const decoded = jwt.verify(token, requireSecret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub) return null;
    return { sub: String(decoded.sub), email: String((decoded as JwtClaims).email ?? '') };
  } catch {
    return null;
  }
};
