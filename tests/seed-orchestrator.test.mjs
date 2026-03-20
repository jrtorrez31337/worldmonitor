import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger } from '../scripts/seed-utils/logger.mjs';
import { parseFreshness, isFresh, buildMeta } from '../scripts/seed-utils/meta.mjs';
import { forkSeeder } from '../scripts/seed-utils/runner.mjs';
import { SEED_CATALOG, TIER_ORDER, TIER_CONCURRENCY, STEADY_STATE_CONCURRENCY } from '../scripts/seed-config.mjs';
import { classifySeeders, buildStartupSummary } from '../scripts/seed-orchestrator.mjs';

describe('logger', () => {
  it('prefixes messages with the given name', () => {
    const lines = [];
    const log = createLogger('earthquakes', { write: (msg) => lines.push(msg) });
    log.info('seeded 847 items');
    assert.match(lines[0], /\[seed:earthquakes\] seeded 847 items/);
  });

  it('formats error messages', () => {
    const lines = [];
    const log = createLogger('webcams', { write: (msg) => lines.push(msg) });
    log.error('HTTP 429');
    assert.match(lines[0], /\[seed:webcams\] error: HTTP 429/);
  });

  it('uses orchestrator prefix for orchestrator name', () => {
    const lines = [];
    const log = createLogger('orchestrator', { write: (msg) => lines.push(msg) });
    log.info('starting...');
    assert.match(lines[0], /\[orchestrator\] starting\.\.\./);
  });
});

describe('meta', () => {
  describe('parseFreshness', () => {
    it('parses valid seed-meta object (from redisGet which returns parsed JSON)', () => {
      const obj = { fetchedAt: 1000, recordCount: 50, sourceVersion: 'v1' };
      const result = parseFreshness(obj);
      assert.equal(result.fetchedAt, 1000);
      assert.equal(result.recordCount, 50);
    });

    it('parses valid seed-meta string', () => {
      const raw = JSON.stringify({ fetchedAt: 1000, recordCount: 50, sourceVersion: 'v1' });
      const result = parseFreshness(raw);
      assert.equal(result.fetchedAt, 1000);
    });

    it('returns null for missing data', () => {
      assert.equal(parseFreshness(null), null);
      assert.equal(parseFreshness(''), null);
      assert.equal(parseFreshness(undefined), null);
    });

    it('returns null for objects without fetchedAt', () => {
      assert.equal(parseFreshness({ recordCount: 5 }), null);
    });
  });

  describe('isFresh', () => {
    it('returns true when data is within interval', () => {
      const meta = { fetchedAt: Date.now() - 60_000 }; // 1 min ago
      assert.equal(isFresh(meta, 5), true);              // 5 min interval
    });

    it('returns false when data is stale', () => {
      const meta = { fetchedAt: Date.now() - 600_000 }; // 10 min ago
      assert.equal(isFresh(meta, 5), false);              // 5 min interval
    });

    it('returns false for null meta', () => {
      assert.equal(isFresh(null, 5), false);
    });
  });

  describe('buildMeta', () => {
    it('builds success meta', () => {
      const meta = buildMeta(2340, 'ok');
      assert.equal(meta.status, 'ok');
      assert.equal(meta.durationMs, 2340);
      assert.ok(meta.fetchedAt > 0);
      assert.equal(meta.error, undefined);
    });

    it('builds error meta with message', () => {
      const meta = buildMeta(5200, 'error', 'HTTP 429');
      assert.equal(meta.status, 'error');
      assert.equal(meta.error, 'HTTP 429');
    });
  });
});

describe('runner', () => {
  it('runs a script that exits 0 and reports success', async () => {
    const result = await forkSeeder('test-ok', {
      scriptPath: process.execPath,
      args: ['-e', 'process.exit(0)'],
      timeoutMs: 5000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.status, 'ok');
    assert.equal(result.name, 'test-ok');
    assert.ok(result.durationMs >= 0);
  });

  it('runs a script that exits 1 and reports error', async () => {
    const result = await forkSeeder('test-fail', {
      scriptPath: process.execPath,
      args: ['-e', 'process.exit(1)'],
      timeoutMs: 5000,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'error');
  });

  it('kills a script that exceeds timeout', async () => {
    const result = await forkSeeder('test-hang', {
      scriptPath: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 500,
    });
    assert.equal(result.status, 'timeout');
    assert.equal(result.exitCode, null);
  });
});

describe('seed-config', () => {
  it('exports a catalog with entries for all seed scripts', () => {
    assert.equal(Object.keys(SEED_CATALOG).length, 42);
  });

  it('every entry has required fields', () => {
    for (const [name, cfg] of Object.entries(SEED_CATALOG)) {
      assert.ok(['hot', 'warm', 'cold', 'frozen'].includes(cfg.tier), `${name}: invalid tier ${cfg.tier}`);
      assert.ok(typeof cfg.intervalMin === 'number' && cfg.intervalMin > 0, `${name}: invalid intervalMin`);
      assert.ok(typeof cfg.ttlSec === 'number' && cfg.ttlSec > 0, `${name}: invalid ttlSec`);
      assert.ok(['source', 'inferred'].includes(cfg.ttlSource), `${name}: invalid ttlSource`);
      assert.ok(Array.isArray(cfg.requiredKeys), `${name}: requiredKeys must be array`);
      assert.ok(cfg.metaKey === null || typeof cfg.metaKey === 'string', `${name}: metaKey must be string or null`);
    }
  });

  it('intervalMin is always less than ttlSec / 60', () => {
    for (const [name, cfg] of Object.entries(SEED_CATALOG)) {
      assert.ok(cfg.intervalMin < cfg.ttlSec / 60, `${name}: intervalMin ${cfg.intervalMin} >= ttlSec/60 ${cfg.ttlSec / 60}`);
    }
  });

  it('TIER_ORDER defines execution order', () => {
    assert.deepEqual(TIER_ORDER, ['hot', 'warm', 'cold', 'frozen']);
  });

  it('TIER_CONCURRENCY defines concurrency caps', () => {
    assert.equal(TIER_CONCURRENCY.hot, 3);
    assert.equal(TIER_CONCURRENCY.warm, 5);
    assert.equal(TIER_CONCURRENCY.cold, 3);
    assert.equal(TIER_CONCURRENCY.frozen, 2);
  });

  it('STEADY_STATE_CONCURRENCY is 5', () => {
    assert.equal(STEADY_STATE_CONCURRENCY, 5);
  });

  it('every catalog name matches a seed-*.mjs file', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const name of Object.keys(SEED_CATALOG)) {
      const filePath = path.join(process.cwd(), 'scripts', `seed-${name}.mjs`);
      assert.ok(fs.existsSync(filePath), `${name}: missing file seed-${name}.mjs`);
    }
  });
});

describe('orchestrator', () => {
  describe('classifySeeders', () => {
    it('splits seeders into active and skipped based on env vars', () => {
      const catalog = {
        'earthquakes': { tier: 'warm', intervalMin: 30, ttlSec: 3600, ttlSource: 'source', requiredKeys: [], metaKey: 'seismology:earthquakes' },
        'market-quotes': { tier: 'hot', intervalMin: 10, ttlSec: 1800, ttlSource: 'source', requiredKeys: ['FINNHUB_API_KEY'], metaKey: 'market:quotes' },
        'economy': { tier: 'warm', intervalMin: 30, ttlSec: 3600, ttlSource: 'source', requiredKeys: ['FRED_API_KEY'], metaKey: 'economic:energy-prices' },
      };
      const env = { FRED_API_KEY: 'test' };
      const { active, skipped } = classifySeeders(catalog, env);

      assert.equal(active.length, 2); // earthquakes + economy
      assert.equal(skipped.length, 1); // market-quotes
      assert.ok(skipped[0].name === 'market-quotes');
      assert.ok(skipped[0].reason.includes('FINNHUB_API_KEY'));
      assert.ok(active.some(s => s.name === 'earthquakes'));
      assert.ok(active.some(s => s.name === 'economy'));
    });
  });

  describe('buildStartupSummary', () => {
    it('returns formatted summary string', () => {
      const active = [
        { name: 'earthquakes', tier: 'warm' },
        { name: 'weather-alerts', tier: 'hot' },
      ];
      const skipped = [
        { name: 'market-quotes', reason: 'missing FINNHUB_API_KEY' },
      ];
      const summary = buildStartupSummary(active, skipped, 1);
      assert.ok(summary.includes('ACTIVE (2)'));
      assert.ok(summary.includes('SKIPPED (1)'));
      assert.ok(summary.includes('market-quotes'));
      assert.ok(summary.includes('FINNHUB_API_KEY'));
      assert.ok(summary.includes('1/2 seeders have fresh data'));
    });
  });
});
