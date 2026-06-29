// ArtifactStore (brief §5) — typed agent outputs, stored once and referenced by id
// downstream (no long unstructured text passed between agents). put() validates the
// payload against the matching artifact Zod schema BEFORE insert, so a malformed
// agent output is rejected at the boundary, not propagated. DB-backed (wf_artifact).
import { prisma } from '../../db/client.ts';
import { artifactSchemaFor, type ArtifactType } from '../schemas/artifact-schemas.ts';

export interface StoredArtifact {
  id: string;
  type: ArtifactType;
  nodeId: string;
  data: unknown;
}

export class ArtifactValidationError extends Error {
  constructor(public type: ArtifactType, public detail: string[]) {
    super(`artifact ${type} failed validation: ${detail.join('; ')}`);
    this.name = 'ArtifactValidationError';
  }
}

// Validate + persist an artifact produced by a node. Throws ArtifactValidationError
// (recoverable — the executor maps it to a failed node, not a 500).
export const putArtifact = async (
  runId: string,
  ownerId: string,
  nodeId: string,
  type: ArtifactType,
  data: unknown,
): Promise<StoredArtifact> => {
  const schema = artifactSchemaFor[type];
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ArtifactValidationError(type, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const row = await prisma.artifact.create({
    data: { runId, ownerId, nodeId, type, data: parsed.data as object },
  });
  return { id: row.id, type, nodeId, data: parsed.data };
};

export const getArtifact = async (id: string, ownerId: string): Promise<StoredArtifact | null> => {
  const row = await prisma.artifact.findFirst({ where: { id, ownerId } });
  if (!row) return null;
  return { id: row.id, type: row.type as ArtifactType, nodeId: row.nodeId, data: row.data };
};

export const listArtifacts = async (runId: string): Promise<StoredArtifact[]> => {
  const rows = await prisma.artifact.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, type: r.type as ArtifactType, nodeId: r.nodeId, data: r.data }));
};
