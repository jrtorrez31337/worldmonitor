import type { AppContext } from '@/app/app-context';
import type { DomainAdapter, SignalEvidence } from '../types';
import { matchCountryNamesInText, getCountryAtCoordinates } from '@/services/country-geometry';

// v1 weights: displacement and cii_delta deferred — renormalized to sum to 1.0.
const WEIGHTS: Record<string, number> = {
  conflict_event: 0.45,
  internet_outage: 0.25,
  news_severity: 0.30,
};

const ESCALATION_KEYWORDS = /\b(war|invasion|attack|bombing|strike|missile|airstrike|offensive|troops|military|killed|casualties|ceasefire|martial\s+law|clashes|conflict|fighting|shelling|drone|explosion|gunfire|protest|riot|coup|insurgent|rebel|militia|terror|hostage|siege|blockade|mobiliz|escalat|retaliat|deploy|incursion|annexed|occupation|humanitarian|refugee|displaced|evacuat|emergency|crisis|threat|sanctions|weapon|nuclear|chemical|biological)\b/i;

export const escalationAdapter: DomainAdapter = {
  domain: 'escalation',
  label: 'Escalation Monitor',
  clusterMode: 'country',
  spatialRadius: 0,
  timeWindow: 48,
  threshold: 20,
  weights: WEIGHTS,

  collectSignals(ctx: AppContext): SignalEvidence[] {
    const signals: SignalEvidence[] = [];
    const now = Date.now();
    const windowMs = 48 * 60 * 60 * 1000;
    const cache = ctx.intelligenceCache;

    // Conflict/protest events — ProtestSeverity is 'low' | 'medium' | 'high'
    const protests = cache.protests?.events ?? [];
    for (const p of protests) {
      const age = now - (p.time?.getTime?.() ?? now);
      if (age > windowMs) continue;

      const severityMap: Record<string, number> = { high: 85, medium: 55, low: 30 };
      const severity = severityMap[p.severity] ?? 40;

      signals.push({
        type: 'conflict_event',
        source: 'signal-aggregator',
        severity,
        lat: p.lat,
        lon: p.lon,
        country: p.country,
        timestamp: p.time?.getTime?.() ?? now,
        label: `${p.eventType}: ${p.title}`,
        rawData: p,
      });
    }

    // Internet outages
    const outages = cache.outages ?? [];
    for (const o of outages) {
      const age = now - (o.pubDate?.getTime?.() ?? now);
      if (age > windowMs) continue;

      const severityMap: Record<string, number> = { total: 90, major: 70, partial: 40 };
      const severity = severityMap[o.severity] ?? 30;

      signals.push({
        type: 'internet_outage',
        source: 'signal-aggregator',
        severity,
        lat: o.lat,
        lon: o.lon,
        country: o.country,
        timestamp: o.pubDate?.getTime?.() ?? now,
        label: `${o.severity} outage: ${o.title}`,
        rawData: o,
      });
    }

    // High-severity news clusters — extract country from title
    const clusters = ctx.latestClusters ?? [];
    for (const c of clusters) {
      if (!c.threat || c.threat.level === 'info' || c.threat.level === 'low') continue;
      const age = now - (c.lastUpdated.getTime());
      if (age > windowMs) continue;
      if (!ESCALATION_KEYWORDS.test(c.primaryTitle)) continue;

      const severity = c.threat.level === 'critical' ? 85
        : c.threat.level === 'high' ? 65
        : 45;

      // Extract country from title text
      const matchedCountries = matchCountryNamesInText(c.primaryTitle);
      let country: string | undefined = matchedCountries[0];
      if (!country && c.lat != null && c.lon != null) {
        const geo = getCountryAtCoordinates(c.lat, c.lon);
        country = geo?.code;
      }
      if (!country) continue; // can't cluster without country

      signals.push({
        type: 'news_severity',
        source: 'analysis-core',
        severity,
        lat: c.lat,
        lon: c.lon,
        country,
        timestamp: c.lastUpdated.getTime(),
        label: c.primaryTitle,
        rawData: c,
      });
    }

    return signals;
  },

  generateTitle(cluster: SignalEvidence[]): string {
    const types = new Set(cluster.map(s => s.type));
    const countries = [...new Set(cluster.map(s => s.country).filter(Boolean))];
    const countryLabel = countries[0] || 'Unknown';

    const parts: string[] = [];
    if (types.has('conflict_event')) parts.push('conflict');
    if (types.has('internet_outage')) parts.push('comms disruption');
    if (types.has('news_severity')) parts.push('news escalation');

    return parts.length > 0
      ? `${parts.join(' + ')} \u2014 ${countryLabel}`
      : `Escalation signals \u2014 ${countryLabel}`;
  },
};
