CREATE TABLE IF NOT EXISTS behavior_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pair TEXT NOT NULL, timeframe TEXT NOT NULL, regime TEXT NOT NULL,
  sequence_key TEXT NOT NULL, sequence_version TEXT NOT NULL, features JSONB NOT NULL DEFAULT '{}', occurrence_count INTEGER NOT NULL DEFAULT 0,
  validation_sample_size INTEGER NOT NULL DEFAULT 0, historical_outcomes JSONB NOT NULL DEFAULT '{}', out_of_sample_metrics JSONB NOT NULL DEFAULT '{}', walk_forward_metrics JSONB NOT NULL DEFAULT '{}', stability_score NUMERIC, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS price_level_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pair TEXT NOT NULL, timeframe TEXT NOT NULL, level_price NUMERIC NOT NULL, detection_method TEXT NOT NULL,
  touch_count INTEGER NOT NULL DEFAULT 0, rejection_count INTEGER NOT NULL DEFAULT 0, breakout_count INTEGER NOT NULL DEFAULT 0, retest_count INTEGER NOT NULL DEFAULT 0, continuation_count INTEGER NOT NULL DEFAULT 0, reversal_count INTEGER NOT NULL DEFAULT 0,
  regime TEXT NOT NULL, historical_context JSONB NOT NULL DEFAULT '{}', validation_status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS temporal_behaviors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pair TEXT NOT NULL, timeframe TEXT NOT NULL, time_window TEXT NOT NULL, regime TEXT NOT NULL, pattern TEXT, sequence TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 0, outcome_distribution JSONB NOT NULL DEFAULT '{}', sample_size INTEGER NOT NULL DEFAULT 0, stability_score NUMERIC, out_of_sample_metrics JSONB NOT NULL DEFAULT '{}', walk_forward_metrics JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS regime_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pair TEXT NOT NULL, timeframe TEXT NOT NULL, transition_timestamp TIMESTAMPTZ NOT NULL, previous_regime TEXT NOT NULL, new_regime TEXT NOT NULL,
  transition_features JSONB NOT NULL DEFAULT '{}', confidence NUMERIC, sample_size INTEGER NOT NULL DEFAULT 0, historical_behavior JSONB NOT NULL DEFAULT '{}', validation_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS movement_behaviors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pair TEXT NOT NULL, timeframe TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, source TEXT NOT NULL, features JSONB NOT NULL, quality_status TEXT NOT NULL, feature_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pattern_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_key TEXT NOT NULL, pair TEXT NOT NULL, timeframe TEXT NOT NULL, discovered_at TIMESTAMPTZ NOT NULL,
  features JSONB NOT NULL, status TEXT NOT NULL, in_sample_metrics JSONB NOT NULL DEFAULT '{}', multiple_testing_adjustment NUMERIC
);
CREATE TABLE IF NOT EXISTS pattern_validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_candidate_id UUID REFERENCES pattern_candidates(id), method TEXT NOT NULL, sample_size INTEGER NOT NULL DEFAULT 0,
  leakage_detected BOOLEAN NOT NULL DEFAULT FALSE, metrics JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pattern_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id UUID REFERENCES behavior_patterns(id), observed_at TIMESTAMPTZ NOT NULL, horizon_minutes INTEGER NOT NULL,
  outcome_available_at TIMESTAMPTZ, outcome BOOLEAN, evaluated BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS behavior_context_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id UUID REFERENCES behavior_patterns(id), pair TEXT NOT NULL, timeframe TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  match_status TEXT NOT NULL, context JSONB NOT NULL, evidence_id UUID REFERENCES behavior_evidence(id)
);
