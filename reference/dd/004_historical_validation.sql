CREATE TABLE IF NOT EXISTS behavior_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  provider TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  regime TEXT NOT NULL,
  observation_timestamp TIMESTAMPTZ NOT NULL,
  outcome_timestamp TIMESTAMPTZ,
  validation_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS behavior_validation_lookup_idx ON behavior_validation_results (pattern_id, symbol, timeframe, regime, created_at DESC);
