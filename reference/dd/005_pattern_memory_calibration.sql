CREATE TABLE IF NOT EXISTS validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id TEXT NOT NULL, validation_version TEXT NOT NULL, dataset_version TEXT NOT NULL, pattern_version TEXT NOT NULL, feature_version TEXT NOT NULL,
  method TEXT NOT NULL, sample_size INTEGER NOT NULL DEFAULT 0, metrics JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS calibration_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id TEXT NOT NULL, symbol TEXT NOT NULL, provider TEXT NOT NULL, timeframe TEXT NOT NULL, regime TEXT NOT NULL, horizon_minutes INTEGER,
  calibration_version TEXT NOT NULL, dataset_version TEXT NOT NULL, sample_size INTEGER NOT NULL DEFAULT 0, brier_score NUMERIC, log_loss NUMERIC, calibration_error NUMERIC, method TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pattern_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id TEXT NOT NULL, pattern_version TEXT NOT NULL, symbol TEXT NOT NULL, provider TEXT NOT NULL, timeframe TEXT NOT NULL, regime TEXT NOT NULL, horizon_minutes INTEGER,
  sample_size INTEGER NOT NULL DEFAULT 0, metrics JSONB NOT NULL DEFAULT '{}', stability_score NUMERIC, uncertainty TEXT NOT NULL DEFAULT 'HIGH', observed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS pattern_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id TEXT NOT NULL, pattern_version TEXT NOT NULL, lifecycle_state TEXT NOT NULL, reason TEXT NOT NULL, evidence JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pattern_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pattern_id TEXT NOT NULL, pattern_version TEXT NOT NULL, detector_type TEXT NOT NULL, symbol TEXT NOT NULL, provider TEXT NOT NULL, timeframe TEXT NOT NULL, regime TEXT NOT NULL, horizon_minutes INTEGER,
  evidence_history JSONB NOT NULL DEFAULT '[]', validation_history JSONB NOT NULL DEFAULT '[]', performance_history JSONB NOT NULL DEFAULT '[]', lifecycle_state TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (pattern_id, pattern_version, symbol, provider, timeframe, regime, horizon_minutes)
);
