CREATE TABLE IF NOT EXISTS behavior_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key TEXT NOT NULL,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  regime TEXT NOT NULL,
  horizon_minutes INTEGER,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  validation_sample_size INTEGER NOT NULL DEFAULT 0,
  in_sample_metrics JSONB NOT NULL DEFAULT '{}',
  out_of_sample_metrics JSONB NOT NULL DEFAULT '{}',
  walk_forward_metrics JSONB NOT NULL DEFAULT '{}',
  calibration_metrics JSONB NOT NULL DEFAULT '{}',
  uncertainty TEXT NOT NULL DEFAULT 'HIGH',
  stability_score NUMERIC,
  last_observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pattern_key, pair, timeframe, regime, version)
);

CREATE TABLE IF NOT EXISTS behavior_evidence (
  id UUID PRIMARY KEY,
  pattern_id UUID REFERENCES behavior_patterns(id),
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  provider TEXT NOT NULL,
  module TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL,
  direction TEXT NOT NULL,
  features JSONB NOT NULL,
  validation_status TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detector_correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detector_a TEXT NOT NULL,
  detector_b TEXT NOT NULL,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  feature_overlap NUMERIC,
  output_correlation NUMERIC,
  sample_size INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (detector_a, detector_b, pair, timeframe)
);
