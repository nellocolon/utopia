-- ============================================================
-- UTOPIA -- 02_ads_schema.sql
-- Esegui per SECONDO nel SQL Editor di Supabase
-- DOPO aver eseguito 01_mvp_schema.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE ad_type_enum AS ENUM ('rewarded_user', 'creator_daily');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_event_type AS ENUM ('free_month_earned', 'milestone_tier_reached', 'manual_extension');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE milestone_tier_status AS ENUM ('active', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CREATOR ADS
CREATE TABLE IF NOT EXISTS creator_ads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id     UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES users(id),
  title            TEXT,
  ad_network       TEXT NOT NULL DEFAULT 'placeholder',
  ad_unit_id       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  total_views      INTEGER NOT NULL DEFAULT 0,
  verified_views   INTEGER NOT NULL DEFAULT 0,
  revenue_estimate NUMERIC(10,6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_creator_ads_community_id ON creator_ads(community_id);
CREATE INDEX IF NOT EXISTS idx_creator_ads_is_active    ON creator_ads(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_creator_ads_created_at   ON creator_ads(created_at DESC);

-- AD VIEWS
-- Nota: colonna view_date (DATE plain) usata per unicita giornaliera
-- evita funzioni nell'indice che causerebbero errore IMMUTABLE
CREATE TABLE IF NOT EXISTS ad_views (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id     UUID REFERENCES communities(id) ON DELETE SET NULL,
  ad_id            UUID REFERENCES creator_ads(id) ON DELETE SET NULL,
  ad_type          ad_type_enum NOT NULL,
  watch_duration_s INTEGER NOT NULL DEFAULT 0,
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at      TIMESTAMPTZ,
  session_id       TEXT NOT NULL,
  ip_hash          TEXT NOT NULL,
  revenue_estimate NUMERIC(8,6) NOT NULL DEFAULT 0,
  view_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  viewed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ad_view_session UNIQUE (session_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_views_user_id      ON ad_views(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_community_id ON ad_views(community_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_ad_id        ON ad_views(ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_viewed_at    ON ad_views(viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_views_ip_hash      ON ad_views(ip_hash, viewed_at);

-- Unicita: un rewarded_user ad per utente per giorno (colonna plain DATE, nessuna funzione)
CREATE UNIQUE INDEX IF NOT EXISTS uq_rewarded_ad_per_user_per_day
  ON ad_views(user_id, view_date)
  WHERE ad_type = 'rewarded_user' AND verified = TRUE;

-- Unicita: un creator_daily ad per utente per ad
CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_ad_per_user_per_ad
  ON ad_views(user_id, ad_id)
  WHERE ad_type = 'creator_daily' AND verified = TRUE;

-- SUBSCRIPTION EVENTS
CREATE TABLE IF NOT EXISTS subscription_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  event_type   subscription_event_type NOT NULL,
  views_reached INTEGER,
  days_extended INTEGER,
  tier_name    TEXT,
  triggered_by UUID REFERENCES users(id),
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_community_id ON subscription_events(community_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_created_at   ON subscription_events(created_at DESC);

-- MILESTONE TIERS
CREATE TABLE IF NOT EXISTS milestone_tiers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  views_required INTEGER NOT NULL,
  days_reward    INTEGER NOT NULL,
  crypto_reward  NUMERIC(18,8),
  status         milestone_tier_status NOT NULL DEFAULT 'active',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO milestone_tiers (name, views_required, days_reward, sort_order)
SELECT 'starter', 10000, 30, 1 WHERE NOT EXISTS (SELECT 1 FROM milestone_tiers WHERE name = 'starter');
INSERT INTO milestone_tiers (name, views_required, days_reward, sort_order)
SELECT 'growth',  25000, 60, 2 WHERE NOT EXISTS (SELECT 1 FROM milestone_tiers WHERE name = 'growth');
INSERT INTO milestone_tiers (name, views_required, days_reward, sort_order)
SELECT 'scale',   50000, 120, 3 WHERE NOT EXISTS (SELECT 1 FROM milestone_tiers WHERE name = 'scale');

-- IP AD RATE
CREATE TABLE IF NOT EXISTS ip_ad_rate (
  ip_hash      TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  view_count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ip_rate_window ON ip_ad_rate(window_start);

-- DAILY POINT CLAIMS
CREATE TABLE IF NOT EXISTS daily_point_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_date   DATE NOT NULL,
  base_points  INTEGER NOT NULL,
  bonus_points INTEGER NOT NULL DEFAULT 0,
  final_points INTEGER NOT NULL,
  ad_view_id   UUID REFERENCES ad_views(id),
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_daily_claim_per_user UNIQUE (user_id, claim_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_claims_user_id    ON daily_point_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_claims_claim_date ON daily_point_claims(claim_date DESC);

-- ATOMIC MILESTONE FUNCTION
CREATE OR REPLACE FUNCTION process_milestone_if_reached(p_community_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_community  communities%ROWTYPE;
  v_tier       milestone_tiers%ROWTYPE;
  v_new_expiry TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_community FROM communities WHERE id = p_community_id FOR UPDATE;

  SELECT * INTO v_tier
  FROM milestone_tiers
  WHERE views_required <= v_community.cumulative_creator_ad_views AND status = 'active'
  ORDER BY views_required DESC LIMIT 1;

  IF v_tier IS NULL THEN
    RETURN jsonb_build_object('triggered', false);
  END IF;

  v_new_expiry := GREATEST(NOW(), COALESCE(v_community.subscription_expires_at, NOW()))
                  + (v_tier.days_reward || ' days')::INTERVAL;

  UPDATE communities SET
    subscription_expires_at     = v_new_expiry,
    cumulative_creator_ad_views = cumulative_creator_ad_views - v_tier.views_required,
    free_months_earned_total    = free_months_earned_total + 1,
    updated_at                  = NOW()
  WHERE id = p_community_id;

  UPDATE users SET
    subscription_expires_at = v_new_expiry,
    updated_at              = NOW()
  WHERE id = v_community.owner_id;

  INSERT INTO subscription_events (
    community_id, event_type, views_reached, days_extended, tier_name, metadata
  ) VALUES (
    p_community_id, 'free_month_earned', v_tier.views_required, v_tier.days_reward, v_tier.name,
    jsonb_build_object('new_expiry', v_new_expiry, 'tier_id', v_tier.id)
  );

  RETURN jsonb_build_object(
    'triggered', true, 'tier', v_tier.name,
    'days_extended', v_tier.days_reward, 'new_expiry', v_new_expiry
  );
END;
$$;
