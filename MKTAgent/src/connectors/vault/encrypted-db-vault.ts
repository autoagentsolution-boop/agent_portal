// Encrypted-DB vault (MVP CredentialVault impl, brief §11.14). Seals secrets as the
// existing AES-256-GCM ciphertext (lib/crypto.ts) stored INLINE in the OAuthToken row
// — no external service, no migration. This is the current behavior, now behind the
// vault interface so an external-vault impl can replace it without changing callers.
//
// `seal`/`open` are thin async wrappers over the synchronous crypto so the interface
// stays uniform with a future network-backed vault (which is genuinely async).
import { encryptToken, decryptToken } from '../../lib/crypto.ts';
import type { CredentialVault } from './credential-vault.ts';

export const encryptedDbVault: CredentialVault = {
  async seal(secret: string): Promise<string> {
    return encryptToken(secret);
  },
  async open(stored: string): Promise<string> {
    return decryptToken(stored);
  },
};
