/**
 * Seed metadata helpers for the orchestrator.
 *
 * Reads/writes `seed-meta:{domain}:{resource}` keys in the same schema
 * as `writeFreshnessMetadata` in `_seed-utils.mjs`:
 *   { fetchedAt, recordCount, sourceVersion, durationMs?, status? }
 */

/**
 * Parse a raw seed-meta value from Redis.
 * The value may be a parsed object (from _seed-utils.mjs redisGet which JSON.parses)
 * or a raw JSON string.
 * @param {object|string|null} raw
 * @returns {{ fetchedAt: number, recordCount?: number, sourceVersion?: string, status?: string, error?: string } | null}
 */
export function parseFreshness(raw) {
  if (raw == null || raw === '') return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj.fetchedAt !== 'number') return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Check if seed-meta indicates data is still fresh.
 * @param {{ fetchedAt: number } | null} meta — parsed seed-meta
 * @param {number} intervalMin — refresh interval in minutes
 * @returns {boolean}
 */
export function isFresh(meta, intervalMin) {
  if (!meta) return false;
  const ageMs = Date.now() - meta.fetchedAt;
  return ageMs < intervalMin * 60_000;
}

/**
 * Build a seed-meta object for the orchestrator to write after a child process completes.
 * @param {number} durationMs
 * @param {'ok'|'error'} status
 * @param {string} [error]
 * @returns {object}
 */
export function buildMeta(durationMs, status, error) {
  const meta = { fetchedAt: Date.now(), durationMs, status };
  if (error) meta.error = error;
  return meta;
}
