// Original reusable dd engines, isolated from its incomplete server/agent imports.
import { createInterface } from 'node:readline';
import { FeatureEngine } from './vendor/feature-engine.mjs';
import { DataQualityEngine } from './vendor/data-quality.mjs';
import { MarketBehaviorEngine } from './vendor/behavior-engine.mjs';
import { BinarySignalEngine } from './vendor/signal-engine.mjs';
console.info = (...args) => console.error(...args);
const reader = createInterface({ input: process.stdin });
for await (const line of reader) {
  try {
    const { candles, source, symbol, timeframe, seconds, freshness } = JSON.parse(line);
    const now = new Date();
    const closed = candles.filter(c => Date.parse(c.closeTimestamp) <= now.getTime());
    const features = new FeatureEngine().compute(closed, now.toISOString());
    const quality = new DataQualityEngine({ expectedIntervalSeconds: { [timeframe]: seconds }, maxFreshnessSeconds: freshness }).evaluate(closed, now);
    // Upstream only adds STALE_DATA to reasons, but leaves status VALID. Fail closed.
    if (quality.reasons.includes('STALE_DATA')) quality.status = 'WARNING';
    const regime = features.momentum == null ? 'UNKNOWN' : Math.abs(features.momentum) < .00005 ? 'RANGING' : 'TRENDING';
    const behavior = new MarketBehaviorEngine().analyze(closed, { pair: symbol, timeframe, provider: source, regime, asOfTimestamp: now.toISOString() }).ledger;
    const request = { asset: symbol, providerId: source, providerSymbol: symbol, timeframe, expirySeconds: seconds, featureVersion: features.featureVersion, dataQualityScore: quality.score, regime, validationStatus: 'UNVERIFIED', oosValidated: false, walkForwardValidated: false };
    const orchestration = { evidence: [], weightedProbability: null, agreement: 0, direction: 'NO_SIGNAL', reason: 'AGENT_IMPLEMENTATION_AND_VALIDATION_REQUIRED' };
    const signal = new BinarySignalEngine().evaluate(request, orchestration, { status: 'BLOCKED', simulatedExposure: 0, capitalAtRisk: 0, maximumDrawdown: null });
    process.stdout.write(JSON.stringify({ features, quality, behavior, signal }) + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ error: 'ENGINE_ANALYSIS_FAILED' }) + '\n');
  }
}