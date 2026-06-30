// Credential Vault (brief §11.2/11.17) — the secret-handling boundary. Every OAuth
// token secret is sealed/opened through this interface so the storage scheme is
// pluggable: the MVP encrypted-db-vault keeps AES-256-GCM ciphertext inline in the
// OAuthToken row, but an AWS/GCP Secrets Manager impl can slot in later WITHOUT
// touching callers (honors the [[project-agentportal-m2-connector-oss]] "keep Vault
// pluggable" decision).
//
// The indirection is deliberate: `seal` returns an OPAQUE stored string that the
// caller persists verbatim (it does not interpret it). For the DB vault that string
// IS the ciphertext; for an external vault it would be a `secretRef` pointer like
// `vault://oauth/<ownerId>/<platform>` that the vault resolves on `open`. Callers
// (token-repo) treat it as a black box — that is what makes the swap non-breaking.
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

export interface CredentialVault {
  // Seal a plaintext secret into the opaque storable string (ciphertext or secretRef).
  seal(secret: string): Promise<string>;
  // Resolve a previously-sealed string back to the plaintext secret. Throws on a
  // tampered / malformed / unresolvable value (fail-loud — never returns a partial).
  open(stored: string): Promise<string>;
}

// Canonical secretRef naming for external vaults (unused by the DB vault, which stores
// ciphertext inline). Exposed so an AWS/GCP impl and any audit/redaction code agree on
// the pointer shape rather than re-inventing it.
export const secretRefFor = (ownerId: string, platform: SocialPlatform): string =>
  `vault://oauth/${ownerId}/${platform}`;
