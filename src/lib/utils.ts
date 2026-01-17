export function nowISO() {
  return new Date().toISOString();
}

export function buildIdempotencyKey(source: string, type: string, externalId: string) {
  return `${source}:${type}:${externalId}`;
}
