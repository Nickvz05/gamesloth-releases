CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'FREE',
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS friend_requests (
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests(to_user_id);

CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS friendships_friend_id_idx ON friendships(friend_id);

CREATE TABLE IF NOT EXISTS squads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_room_code TEXT,
  active_room_updated_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS squads_owner_id_idx ON squads(owner_id);

CREATE TABLE IF NOT EXISTS squad_members (
  squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (squad_id, user_id)
);

CREATE INDEX IF NOT EXISTS squad_members_user_id_idx ON squad_members(user_id);

-- Foundation for later cloud/shared Moment metadata.
CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  squad_id TEXT REFERENCES squads(id) ON DELETE SET NULL,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Squad Moment',
  game TEXT NOT NULL DEFAULT 'Gameplay',
  trigger_at BIGINT,
  status TEXT NOT NULL DEFAULT 'collecting',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS moment_povs (
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  storage_url TEXT,
  offset_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (moment_id, player_name)
);


-- Billing / entitlement fields. Safe to run repeatedly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_price_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_unique
  ON users(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_subscription_id_unique
  ON users(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;


-- v0.11 alpha-hardening fields.
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at BIGINT;

CREATE INDEX IF NOT EXISTS users_handle_lower_idx ON users ((lower(handle)));


-- v0.11.1 real squad invitation flow.
CREATE TABLE IF NOT EXISTS squad_invites (
  squad_id TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (squad_id, to_user_id)
);

CREATE INDEX IF NOT EXISTS squad_invites_to_user_idx
  ON squad_invites(to_user_id, created_at);


-- v0.16 per-account onboarding.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_version INTEGER NOT NULL DEFAULT 0;

-- v0.31 ads campaign manager and privacy-conscious event tracking.
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id TEXT PRIMARY KEY,
  sponsor TEXT,
  label TEXT NOT NULL DEFAULT 'Sponsored',
  headline TEXT NOT NULL,
  description TEXT NOT NULL,
  button_label TEXT NOT NULL DEFAULT 'View offer',
  action_type TEXT NOT NULL DEFAULT 'external',
  action_value TEXT,
  logo_url TEXT,
  banner_url TEXT,
  brand_color TEXT,
  placements TEXT[] NOT NULL DEFAULT ARRAY['clips','moments']::TEXT[],
  weight INTEGER NOT NULL DEFAULT 10,
  frequency_cap_hours INTEGER NOT NULL DEFAULT 12,
  starts_at BIGINT,
  ends_at BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (action_type IN ('external','plans'))
);

CREATE TABLE IF NOT EXISTS ad_events (
  id BIGSERIAL PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  visitor_key TEXT NOT NULL,
  placement TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  CHECK (placement IN ('clips','moments')),
  CHECK (event_type IN ('impression','click'))
);

CREATE INDEX IF NOT EXISTS ad_events_campaign_idx ON ad_events(campaign_id, occurred_at);
CREATE INDEX IF NOT EXISTS ad_events_visitor_idx ON ad_events(visitor_key, occurred_at);


-- v0.32.2 optional sponsor creative assets.
-- ALTER statements keep existing Render databases compatible without a manual migration.
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS brand_color TEXT;

INSERT INTO ad_campaigns
  (id, sponsor, label, headline, description, button_label, action_type, placements, weight, frequency_cap_hours, active, created_at, updated_at)
VALUES
  ('gamesloth-plus-house', 'GameSloth', 'GameSloth', 'Go ad-free with Sloth+', 'Remove sponsor cards and unlock faster creator exports, Auto Shorts and AI Captions.', 'View Sloth+', 'plans', ARRAY['clips','moments'], 12, 8, TRUE, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
  ('gamesloth-pro-house', 'GameSloth', 'GameSloth', 'Turn every POV into one finished video', 'Sloth Pro adds Sloth Director, cinematic multi-POV cuts and the advanced creator workflow.', 'View Sloth Pro', 'plans', ARRAY['clips','moments'], 8, 12, TRUE, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
ON CONFLICT (id) DO NOTHING;

-- One row is one host-created multi-POV Moment reservation in a UTC calendar month.
-- The rows provide the public aggregate Moment total and enforce the monthly Free-plan allowance.
CREATE TABLE IF NOT EXISTS moment_save_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  moment_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  pov_count INTEGER NOT NULL DEFAULT 2,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, period_key, moment_key),
  CHECK (pov_count >= 2),
  CHECK (char_length(period_key) = 7)
);

CREATE INDEX IF NOT EXISTS moment_save_usage_user_period_idx
  ON moment_save_usage(user_id, period_key, created_at);



-- v0.32.7 Closed Alpha feedback intake and review workflow.
CREATE TABLE IF NOT EXISTS alpha_feedback (
  id TEXT PRIMARY KEY,
  tester_name TEXT,
  email TEXT,
  handle TEXT,
  app_version TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  severity TEXT NOT NULL DEFAULT 'medium',
  area TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  steps TEXT,
  expected TEXT,
  actual TEXT,
  device_info TEXT,
  screenshot_url TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  contact_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'new',
  visitor_key TEXT NOT NULL,
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (category IN ('bug','suggestion','usability','performance','account','sync','billing','ads','other')),
  CHECK (severity IN ('low','medium','high','blocker')),
  CHECK (area IN ('installation','account','recording','clips','moments','social','sync','plans','ads','updater','other')),
  CHECK (source IN ('website','desktop')),
  CHECK (status IN ('new','reviewing','planned','fixed','closed'))
);

CREATE INDEX IF NOT EXISTS alpha_feedback_created_idx ON alpha_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS alpha_feedback_status_idx ON alpha_feedback(status, created_at DESC);

-- Closed Alpha / Open Beta account access.
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_access_granted_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_invite_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_access_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_reviewed_at BIGINT;

-- Existing accounts keep access. New Closed Alpha registrations explicitly insert 'pending'.
UPDATE users
   SET alpha_access_status = 'approved'
 WHERE alpha_access_status IS NULL;

UPDATE users
   SET alpha_access_granted_at = COALESCE(alpha_access_granted_at, created_at)
 WHERE alpha_access_status = 'approved'
   AND alpha_access_granted_at IS NULL;

ALTER TABLE users ALTER COLUMN alpha_access_status SET DEFAULT 'approved';
ALTER TABLE users ALTER COLUMN alpha_access_status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_alpha_access_status_check
    CHECK (alpha_access_status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS users_alpha_access_status_idx
  ON users(alpha_access_status, created_at DESC);

CREATE TABLE IF NOT EXISTS alpha_invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  label TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (max_uses >= 1 AND max_uses <= 100),
  CHECK (used_count >= 0 AND used_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS alpha_invites_active_idx
  ON alpha_invites(active, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS alpha_invite_redemptions (
  invite_id TEXT NOT NULL REFERENCES alpha_invites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at BIGINT NOT NULL,
  PRIMARY KEY (invite_id, user_id),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS alpha_invite_redemptions_time_idx
  ON alpha_invite_redemptions(redeemed_at DESC);

-- Runtime Closed Alpha / Open Beta controls (v0.32.9).
-- The row is created from server defaults on first use so Render environment
-- variables remain sensible fallbacks while the Alpha Admin can change the
-- mode and limit without a code deploy.
CREATE TABLE IF NOT EXISTS alpha_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  invite_required BOOLEAN NOT NULL DEFAULT TRUE,
  tester_limit INTEGER NOT NULL DEFAULT 20,
  updated_at BIGINT NOT NULL,
  CHECK (tester_limit >= 1 AND tester_limit <= 10000)
);

-- v0.34.0 Founding 50 launch reward. This flag can be paused from Alpha Admin.
ALTER TABLE alpha_settings ADD COLUMN IF NOT EXISTS founding_50_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- v0.33.0 Closed Alpha access request queue.
CREATE TABLE IF NOT EXISTS alpha_access_requests (
  id TEXT PRIMARY KEY,
  tester_name TEXT NOT NULL,
  email TEXT NOT NULL,
  discord_handle TEXT,
  main_games TEXT NOT NULL,
  test_focus TEXT NOT NULL,
  device_info TEXT,
  notes TEXT,
  contact_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending',
  invite_id TEXT REFERENCES alpha_invites(id) ON DELETE SET NULL,
  visitor_key TEXT NOT NULL,
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  reviewed_at BIGINT,
  CHECK (status IN ('pending','invited','rejected','closed'))
);

CREATE INDEX IF NOT EXISTS alpha_access_requests_status_idx
  ON alpha_access_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS alpha_access_requests_email_idx
  ON alpha_access_requests((lower(email)), created_at DESC);


-- v0.33.2 account recovery and optional email verification.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT;
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens(expires_at);
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_verification_tokens_expiry_idx ON email_verification_tokens(expires_at);

-- v0.33.3 complimentary creator / squad-host access.
-- Lets Alpha Admin assign Sloth+ or Sloth Pro to an existing account without
-- changing Stripe billing or editing Render environment variables.
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_plan_override TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_plan_override_expires_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_plan_override_note TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alpha_plan_override_updated_at BIGINT;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_alpha_plan_override_check
    CHECK (alpha_plan_override IS NULL OR alpha_plan_override IN ('SLOTH_PLUS','SLOTH_PRO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS users_alpha_plan_override_idx
  ON users(alpha_plan_override, alpha_plan_override_expires_at)
  WHERE alpha_plan_override IS NOT NULL;

-- v0.34.0 Founding 50 reward metadata. Kept separate from creator grants and Stripe
-- so an existing Pro grant is never downgraded by the launch reward.
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_50_position INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_50_claimed_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_50_expires_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_50_moment_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_50_pov_count INTEGER;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_founding_50_position_check
    CHECK (founding_50_position IS NULL OR founding_50_position BETWEEN 1 AND 50);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_founding_50_pov_count_check
    CHECK (founding_50_pov_count IS NULL OR founding_50_pov_count BETWEEN 2 AND 16);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_founding_50_position_unique
  ON users(founding_50_position)
  WHERE founding_50_position IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_founding_50_claimed_idx
  ON users(founding_50_claimed_at)
  WHERE founding_50_position IS NOT NULL;

-- Durable claim ledger. The snapshot remains even if a user later deletes their account,
-- so a Founding 50 spot never silently reopens.
CREATE TABLE IF NOT EXISTS founding_50_claims (
  position INTEGER PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  moment_key TEXT NOT NULL,
  pov_count INTEGER NOT NULL,
  claimed_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  CHECK (position BETWEEN 1 AND 50),
  CHECK (pov_count BETWEEN 2 AND 16)
);

CREATE UNIQUE INDEX IF NOT EXISTS founding_50_claims_user_unique
  ON founding_50_claims(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS founding_50_claims_time_idx
  ON founding_50_claims(claimed_at);

-- Blocked users for friend request privacy and moderation.
CREATE TABLE IF NOT EXISTS blocked_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS blocked_users_lookup_idx
  ON blocked_users(user_id, blocked_user_id);

-- v0.33.5 opt-in Discord community leaderboard.
-- Only Sloth Sync metadata is stored; clips and video files are never read here.
ALTER TABLE users ADD COLUMN IF NOT EXISTS leaderboard_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS leaderboard_moments (
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moment_key TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL,
  participants JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  ready_povs INTEGER,
  PRIMARY KEY (host_user_id, moment_key),
  CHECK (char_length(moment_key) BETWEEN 1 AND 120),
  CHECK (ready_povs IS NULL OR ready_povs BETWEEN 2 AND 16)
);

CREATE INDEX IF NOT EXISTS leaderboard_moments_creator_idx
  ON leaderboard_moments(creator_id, created_at);
CREATE INDEX IF NOT EXISTS leaderboard_moments_completed_idx
  ON leaderboard_moments(created_at)
  WHERE completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS leaderboard_discord_state (
  webhook_key TEXT PRIMARY KEY,
  message_id TEXT,
  next_attempt_at BIGINT NOT NULL DEFAULT 0
);
