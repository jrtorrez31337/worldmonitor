/**
 * Manual refresh endpoint for webcam data.
 * Spawns seed-webcams.mjs as a background process and returns immediately.
 * Status is tracked in Redis at webcam:refresh:status.
 */

import { execFile } from 'node:child_process';
import { getCachedJson, setCachedJson } from '../../../_shared/redis';

const STATUS_KEY = 'webcam:refresh:status';
const STATUS_TTL = 3600; // 1 hour

interface RefreshStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export async function handleRefresh(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET') {
    const status = await getCachedJson(STATUS_KEY) as RefreshStatus | null;
    return new Response(JSON.stringify(status ?? { state: 'idle' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'POST') {
    // Check if already running
    const current = await getCachedJson(STATUS_KEY) as RefreshStatus | null;
    if (current?.state === 'running') {
      return new Response(JSON.stringify({ error: 'Refresh already in progress', status: current }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = Date.now();
    const action = url.searchParams.get('action');

    if (action === 'flush') {
      // Just flush response caches (webcam:resp:*) without re-seeding from Windy
      await flushResponseCache();
      await setCachedJson(STATUS_KEY, { state: 'completed', startedAt: now, completedAt: Date.now() } satisfies RefreshStatus, STATUS_TTL);
      return new Response(JSON.stringify({ status: 'flushed' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await setCachedJson(STATUS_KEY, { state: 'running', startedAt: now } satisfies RefreshStatus, STATUS_TTL);

    // Run seed script in background using execFile (no shell injection risk)
    execFile('node', ['scripts/seed-webcams.mjs'], {
      env: process.env,
      cwd: process.cwd(),
    }, async (error) => {
      if (error) {
        await setCachedJson(STATUS_KEY, {
          state: 'failed', startedAt: now, completedAt: Date.now(), error: error.message,
        } satisfies RefreshStatus, STATUS_TTL);
      } else {
        // Flush response caches so new data is served immediately
        await flushResponseCache();
        await setCachedJson(STATUS_KEY, {
          state: 'completed', startedAt: now, completedAt: Date.now(),
        } satisfies RefreshStatus, STATUS_TTL);
      }
    });

    return new Response(JSON.stringify({ status: 'started', startedAt: now }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Flush all cached listWebcams responses (webcam:resp:*) */
async function flushResponseCache(): Promise<void> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !token) return;

  try {
    let cursor = '0';
    do {
      const resp = await fetch(`${redisUrl}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['SCAN', cursor, 'MATCH', 'webcam:resp:*', 'COUNT', '200']]),
      });
      const results = await resp.json() as Array<{ result: [string, string[]] }>;
      const [newCursor, keys] = results[0]?.result ?? ['0', []];
      cursor = newCursor;
      if (keys.length > 0) {
        await fetch(`${redisUrl}/pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([['DEL', ...keys]]),
        });
      }
    } while (cursor !== '0');
  } catch (err) {
    console.warn('[webcam] flush response cache failed:', err);
  }
}
