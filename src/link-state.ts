import type { StoredFormLink } from "./types.js";

export function assertRecentLink(storedLink: StoredFormLink, now = new Date()): void {
  if (storedLink.version !== 1 || !storedLink.url || !storedLink.receivedAt) {
    throw new Error("O artefato do link possui formato inválido.");
  }
  const receivedAt = Date.parse(storedLink.receivedAt);
  const age = now.getTime() - receivedAt;
  if (!Number.isFinite(receivedAt) || age < -300_000 || age > 8 * 86_400_000) {
    throw new Error("O link persistido não foi recebido nos últimos oito dias.");
  }
}
