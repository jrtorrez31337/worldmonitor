import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifySeeders,
  buildStartupSummary,
  getEffectiveInterval,
  shouldSkipCycle,
  computeTurboInterval,
} from '../scripts/seed-orchestrator.mjs';
import { isFresh } from '../scripts/seed-utils/meta.mjs';

// ── getEffectiveInterval ─────────────────────────────────────────────────

describe('getEffectiveInterval', () => {
  it('returns normal interval when no turbo and no failures', () => {
    // 30 min * 60_000 = 1_800_000 ms
    assert.equal(getEffectiveInterval(30, 0, undefined), 1_800_000);
  });

  it('compresses interval by 20x in turbo mode', () => {
    // 30 / 20 = 1.5 → rounds to 2 min → 120_000 ms
    assert.equal(getEffectiveInterval(30, 0, 'real'), 120_000);
  });

  it('doubles interval after 5 consecutive failures', () => {
    // 30 min * 2 = 60 min → 3_600_000 ms
    assert.equal(getEffectiveInterval(30, 5, undefined), 3_600_000);
  });

  it('applies both turbo and demotion together', () => {
    // 30 / 20 = 1.5 → rounds to 2, then * 2 = 4 min → 240_000 ms
    assert.equal(getEffectiveInterval(30, 5, 'dry'), 240_000);
  });

  it('never returns less than 1 minute (60_000ms)', () => {
    // 5 / 20 = 0.25 → floors to 1 min → 60_000 ms
    assert.equal(getEffectiveInterval(5, 0, 'real'), 60_000);
  });

  it('4 failures does not trigger demotion', () => {
    assert.equal(getEffectiveInterval(30, 4, undefined), 1_800_000);
  });
});

// ── shouldSkipCycle ──────────────────────────────────────────────────────

describe('shouldSkipCycle', () => {
  it('returns false when seeder not in flight', () => {
    const inFlight = new Set(['other-seeder']);
    assert.equal(shouldSkipCycle('earthquakes', inFlight), false);
  });

  it('returns true when seeder is in flight', () => {
    const inFlight = new Set(['earthquakes']);
    assert.equal(shouldSkipCycle('earthquakes', inFlight), true);
  });

  it('returns false for empty in-flight set', () => {
    assert.equal(shouldSkipCycle('earthquakes', new Set()), false);
  });
});

// ── computeTurboInterval ─────────────────────────────────────────────────

describe('computeTurboInterval', () => {
  it('returns original interval when no turbo', () => {
    assert.equal(computeTurboInterval(30, undefined), 30);
  });

  it('divides by 20 in turbo mode', () => {
    // 120 / 20 = 6
    assert.equal(computeTurboInterval(120, 'real'), 6);
  });

  it('floors to minimum of 1 minute', () => {
    // 5 / 20 = 0.25 → max(1, round(0.25)) = 1
    assert.equal(computeTurboInterval(5, 'dry'), 1);
  });

  it('rounds to nearest integer', () => {
    // 30 / 20 = 1.5 → rounds to 2
    assert.equal(computeTurboInterval(30, 'real'), 2);
  });
});

// ── classifySeeders ──────────────────────────────────────────────────────

describe('classifySeeders', () => {
  const catalog = {
    'earthquakes': { tier: 'warm', intervalMin: 30, ttlSec: 3600, ttlSource: 'source', requiredKeys: [], metaKey: 'seismology:earthquakes' },
    'market-quotes': { tier: 'hot', intervalMin: 10, ttlSec: 1800, ttlSource: 'source', requiredKeys: ['FINNHUB_API_KEY'], metaKey: 'market:quotes' },
    'economy': { tier: 'warm', intervalMin: 30, ttlSec: 3600, ttlSource: 'source', requiredKeys: ['FRED_API_KEY'], metaKey: 'economic:energy-prices' },
  };

  it('all seeders active when no keys required', () => {
    const mini = { 'a': { ...catalog['earthquakes'] } };
    const { active, skipped } = classifySeeders(mini, {});
    assert.equal(active.length, 1);
    assert.equal(skipped.length, 0);
  });

  it('skips seeders with missing required keys', () => {
    const { active, skipped } = classifySeeders(catalog, {});
    assert.equal(skipped.length, 2);
    assert.ok(skipped.some(s => s.name === 'market-quotes'));
    assert.ok(skipped.some(s => s.name === 'economy'));
  });

  it('includes seeders when required keys present', () => {
    const { active, skipped } = classifySeeders(catalog, { FINNHUB_API_KEY: 'x', FRED_API_KEY: 'y' });
    assert.equal(active.length, 3);
    assert.equal(skipped.length, 0);
  });
});

// ── buildStartupSummary ──────────────────────────────────────────────────

describe('buildStartupSummary', () => {
  it('includes active count and tier breakdown', () => {
    const active = [
      { name: 'earthquakes', tier: 'warm' },
      { name: 'weather-alerts', tier: 'hot' },
    ];
    const summary = buildStartupSummary(active, [], 0);
    assert.ok(summary.includes('ACTIVE (2)'));
    assert.ok(summary.includes('hot: weather-alerts'));
    assert.ok(summary.includes('warm: earthquakes'));
  });

  it('includes skipped seeders with reasons', () => {
    const skipped = [{ name: 'market-quotes', reason: 'missing FINNHUB_API_KEY' }];
    const summary = buildStartupSummary([], skipped, 0);
    assert.ok(summary.includes('SKIPPED (1)'));
    assert.ok(summary.includes('FINNHUB_API_KEY'));
  });

  it('includes fresh count', () => {
    const summary = buildStartupSummary([{ name: 'a', tier: 'hot' }], [], 1);
    assert.ok(summary.includes('1/1 seeders have fresh data'));
  });
});

// ── freshness with turbo intervals ───────────────────────────────────────

describe('freshness integration', () => {
  it('isFresh returns false for data older than turbo interval', () => {
    const turboMin = computeTurboInterval(30, 'real'); // 2 min
    const meta = { fetchedAt: Date.now() - 3 * 60_000 }; // 3 min ago
    assert.equal(isFresh(meta, turboMin), false);
  });

  it('isFresh returns true for data within turbo interval', () => {
    const turboMin = computeTurboInterval(30, 'real'); // 2 min
    const meta = { fetchedAt: Date.now() - 30_000 }; // 30 sec ago
    assert.equal(isFresh(meta, turboMin), true);
  });
});
