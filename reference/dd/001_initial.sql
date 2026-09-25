CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT 'UNKNOWN',
  provider_symbol TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'REFERENCE_MARKET_SOURCE',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'UNAVAILABLE', 'DELISTED', 'UNKNOWN')),
  availability BOOLEAN NOT NULL DEFAULT FALSE,
  supported_timeframes TEXT[] NOT NULL DEFAULT '{}',
  data_source TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (provider, provider_symbol)
);

CREATE TABLE IF NOT EXISTS candles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instruments(id),
  timeframe TEXT NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC,
  open_timestamp TIMESTAMPTZ NOT NULL,
  close_timestamp TIMESTAMPTZ NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  ingestion_timestamp TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT 'UNKNOWN',
  provider_symbol TEXT NOT NULL DEFAULT 'UNKNOWN',
  source_type TEXT NOT NULL DEFAULT 'REFERENCE_MARKET_SOURCE',
  quality_status TEXT NOT NULL CHECK (quality_status IN ('VALID', 'WARNING', 'INVALID', 'UNVERIFIED')),
  completeness_status TEXT NOT NULL CHECK (completeness_status IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')),
  sequence_number BIGINT,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('EXPECTED', 'OPEN', 'UPDATED', 'CLOSED', 'VALIDATED', 'INVALID', 'CORRECTED')),
  version INTEGER NOT NULL CHECK (version > 0),
  UNIQUE (instrument_id, timeframe, open_timestamp, version)
);
CREATE INDEX IF NOT EXISTS candles_lookup_idx ON candles (instrument_id, timeframe, open_timestamp DESC);

CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  instrument_id UUID,
  timeframe TEXT NOT NULL,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  system_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS market_events_time_idx ON market_events (event_timestamp DESC);

CREATE TABLE IF NOT EXISTS agent_performance (
  agent_id TEXT NOT NULL,
  instrument_id UUID NOT NULL REFERENCES instruments(id),
  timeframe TEXT NOT NULL,
  regime TEXT NOT NULL,
  observations INTEGER NOT NULL CHECK (observations >= 0),
  accuracy NUMERIC,
  brier_score NUMERIC,
  log_loss NUMERIC,
  calibration_error NUMERIC,
  reliability NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (agent_id, instrument_id, timeframe, regime)
);

CREATE TABLE IF NOT EXISTS analytical_signals (
  id UUID PRIMARY KEY,
  instrument_id UUID REFERENCES instruments(id),
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  expiry_timestamp TIMESTAMPTZ NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('CALL', 'PUT', 'NO_SIGNAL')),
  state TEXT NOT NULL,
  raw_probability NUMERIC,
  calibrated_probability NUMERIC,
  break_even_probability NUMERIC,
  probability_difference NUMERIC,
  agreement NUMERIC NOT NULL CHECK (agreement >= 0 AND agreement <= 1),
  market_regime TEXT NOT NULL,
  data_quality_score NUMERIC NOT NULL CHECK (data_quality_score >= 0 AND data_quality_score <= 100),
  calibration_status TEXT NOT NULL,
  validation_sample_size INTEGER NOT NULL CHECK (validation_sample_size >= 0),
  uncertainty TEXT NOT NULL,
  risk_status TEXT NOT NULL,
  provider_id TEXT,
  provider_symbol TEXT,
  source_type TEXT,
  simulated_exposure NUMERIC NOT NULL DEFAULT 0,
  capital_at_risk NUMERIC NOT NULL DEFAULT 0,
  maximum_drawdown NUMERIC,
  feature_version TEXT NOT NULL,
  model_versions JSONB NOT NULL,
  reason TEXT,
  signal_type TEXT NOT NULL DEFAULT 'ANALYTICAL_SIGNAL',
  execution_order BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS analytical_signals_asset_time_idx ON analytical_signals (asset, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  request_id TEXT,
  previous_state JSONB,
  new_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_type TEXT NOT NULL,
  seed BIGINT NOT NULL,
  starting_capital NUMERIC NOT NULL CHECK (starting_capital > 0),
  ending_capital NUMERIC NOT NULL,
  parameters JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backtests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  parameters JSONB NOT NULL,
  metrics JSONB NOT NULL,
  leakage_detected BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drift_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT,
  instrument_id UUID REFERENCES instruments(id),
  timeframe TEXT,
  status TEXT NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stress_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  parameters JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER', 'RESEARCHER', 'ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instruments(id),
  timeframe TEXT NOT NULL,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  feature_version TEXT NOT NULL,
  values JSONB NOT NULL,
  UNIQUE (instrument_id, timeframe, as_of_timestamp, feature_version)
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  status TEXT NOT NULL,
  drift_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS model_versions (
  model_id TEXT NOT NULL REFERENCES models(id),
  version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  training_status TEXT NOT NULL,
  trained_at TIMESTAMPTZ,
  validation_metrics JSONB NOT NULL,
  test_metrics JSONB NOT NULL,
  calibration_metrics JSONB NOT NULL,
  PRIMARY KEY (model_id, version)
);
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL REFERENCES models(id),
  model_version TEXT NOT NULL,
  instrument_id UUID REFERENCES instruments(id),
  timeframe TEXT NOT NULL,
  prediction_timestamp TIMESTAMPTZ NOT NULL,
  probability NUMERIC NOT NULL CHECK (probability >= 0 AND probability <= 1),
  metadata JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS calibration_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  brier_score NUMERIC,
  log_loss NUMERIC,
  expected_calibration_error NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS walk_forward_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  parameters JSONB NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS monte_carlo_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed BIGINT NOT NULL,
  simulation_count INTEGER NOT NULL,
  parameters JSONB NOT NULL,
  percentiles JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
