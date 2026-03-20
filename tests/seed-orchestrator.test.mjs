import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger } from '../scripts/seed-utils/logger.mjs';

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
