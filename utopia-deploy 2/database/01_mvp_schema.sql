-- ============================================================
-- UTOPIA — 01_mvp_schema.sql
-- Esegui per PRIMO nel SQL Editor di Supabase
-- Apri una nuova query, incolla tutto il contenuto, clicca RUN
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                    TEXT UNIQUE NOT NULL,
  username                 TEXT UNIQUE NOT NULL,
  password_hash            TEXT NOT NULL,
  role                     TEXT NOT NULL DEFAULT 'user'
                             CHECK (role IN ('user', 'admin', 'superadmin')),
  twitter_handle           TEXT,
  avatar_url               TEXT,
  total_xp                 INTEGER NOT NULL DEFAULT 0,
  telegram_id              TEXT UNIQUE,
  telegram_username        TEXT,
  owner_telegram_id        TEXT,
  daily_points             INTEGER NOT NULL DEFAULT 0,
  last_claim_date          DATE,
  rewarded_ad_watched_day  DATE,
  rewarded_ad_timestamp    TIMESTAMPTZ,
  subscription_plan        TEXT NOT NULL DEFAULT 'free'
                             CHECK (subscription_plan IN ('free', 'growth', 'scale')),
  subscription_expires_at  TIMESTAMPTZ,
  abuse_flag               BOOLEAN NOT NULL DEFAULT FALSE,
  abuse_flagged_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id      ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_claim_date  ON users(last_claim_date);
CREATE INDEX IF NOT EXISTS idx_users_rewarded_ad_day  ON users(rewarded_ad_watched_day);
CREATE INDEX IF NOT EXISTS idx_users_abuse_flag       ON users(abuse_flag) WHERE abuse_flag = TRUE;

-- ── COMMUNITIES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communities (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  slug                        TEXT UNIQUE NOT NULL,
  description                 TEXT,
  logo_url                    TEXT,
  twitter_handle              TEXT,
  display_mode                TEXT DEFAULT 'page' CHECK (display_mode IN ('page', 'iframe', 'plugin')),
  reward_type                 TEXT DEFAULT 'fiat' CHECK (reward_type IN ('fiat', 'products', 'crypto')),
  status                      TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  member_count                INTEGER DEFAULT 0,
  settings                    JSONB DEFAULT '{}',
  telegram_chat_id            TEXT,
  telegram_chat_title         TEXT,
  telegram_linked_at          TIMESTAMPTZ,
  owner_telegram_id           TEXT,
  subscription_plan           TEXT NOT NULL DEFAULT 'free',
  subscription_expires_at     TIMESTAMPTZ,
  cumulative_creator_ad_views INTEGER NOT NULL DEFAULT 0,
  free_months_earned_total    INTEGER NOT NULL DEFAULT 0,
  milestone_threshold         INTEGER NOT NULL DEFAULT 10000,
  daily_ad_xp_reward          INTEGER NOT NULL DEFAULT 50,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communities_owner_id           ON communities(owner_id);
CREATE INDEX IF NOT EXISTS idx_communities_slug               ON communities(slug);
CREATE INDEX IF NOT EXISTS idx_communities_telegram_chat_id   ON communities(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communities_owner_telegram_id  ON communities(owner_telegram_id) WHERE owner_telegram_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_community_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM communities WHERE owner_id = NEW.owner_id AND status = 'active') >= 25 THEN
    RAISE EXCEPTION 'Maximum of 25 active communities reached';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_community_limit ON communities;
CREATE TRIGGER enforce_community_limit
  BEFORE INSERT ON communities
  FOR EACH ROW EXECUTE FUNCTION check_community_limit();

-- ── COMMUNITY MEMBERS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_members (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  xp           INTEGER DEFAULT 0,
  rank         INTEGER,
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);
CREATE INDEX IF NOT EXISTS idx_community_members_user      ON community_members(user_id);

-- ── RAIDS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raids (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id     UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  creator_id       UUID NOT NULL REFERENCES users(id),
  tweet_url        TEXT NOT NULL,
  tweet_id         TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  target_likes     INTEGER DEFAULT 100,
  target_retweets  INTEGER DEFAULT 50,
  target_comments  INTEGER DEFAULT 30,
  current_likes    INTEGER DEFAULT 0,
  current_retweets INTEGER DEFAULT 0,
  current_comments INTEGER DEFAULT 0,
  xp_like          INTEGER DEFAULT 10,
  xp_retweet       INTEGER DEFAULT 20,
  xp_comment       INTEGER DEFAULT 15,
  xp_creator       INTEGER DEFAULT 50,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  ends_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raids_community ON raids(community_id);

-- ── RAID PARTICIPANTS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raid_participants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raid_id          UUID NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  did_like         BOOLEAN DEFAULT FALSE,
  did_retweet      BOOLEAN DEFAULT FALSE,
  did_comment      BOOLEAN DEFAULT FALSE,
  verified_like    BOOLEAN DEFAULT FALSE,
  verified_retweet BOOLEAN DEFAULT FALSE,
  verified_comment BOOLEAN DEFAULT FALSE,
  xp_earned        INTEGER DEFAULT 0,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(raid_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_raid_participants_raid ON raid_participants(raid_id);
CREATE INDEX IF NOT EXISTS idx_raid_participants_user ON raid_participants(user_id);

-- ── QUEST TEMPLATES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quest_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id    UUID REFERENCES communities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'one_time', 'referral')),
  action          TEXT NOT NULL CHECK (action IN ('daily_post','community_join','referral','raid_participate','profile_complete','custom')),
  xp_reward       INTEGER NOT NULL DEFAULT 25,
  max_completions INTEGER DEFAULT 1,
  is_active       BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO quest_templates (name, description, type, action, xp_reward, max_completions)
SELECT 'Daily Post','Share a post about the community on X today','daily','daily_post',25,1
WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE action = 'daily_post');

INSERT INTO quest_templates (name, description, type, action, xp_reward, max_completions)
SELECT 'Join Community','Join the official Telegram community group','one_time','community_join',50,1
WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE action = 'community_join');

INSERT INTO quest_templates (name, description, type, action, xp_reward, max_completions)
SELECT 'Referral Bonus','Invite a friend via your referral link','weekly','referral',50,NULL
WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE action = 'referral');

INSERT INTO quest_templates (name, description, type, action, xp_reward, max_completions)
SELECT 'Complete Profile','Connect your Twitter and Telegram accounts','one_time','profile_complete',30,1
WHERE NOT EXISTS (SELECT 1 FROM quest_templates WHERE action = 'profile_complete');

-- ── QUEST INSTANCES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quest_instances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id  UUID NOT NULL REFERENCES quest_templates(id),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','expired')),
  progress     INTEGER DEFAULT 0,
  xp_awarded   INTEGER DEFAULT 0,
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quest_instances_user ON quest_instances(user_id);

-- ── USER QUEST COMPLETIONS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS user_quest_completions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_instance_id UUID NOT NULL REFERENCES quest_instances(id),
  community_id      UUID NOT NULL REFERENCES communities(id),
  xp_awarded        INTEGER NOT NULL,
  completed_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── POINTS LOG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS points_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id   UUID REFERENCES communities(id),
  action         TEXT NOT NULL,
  xp_delta       INTEGER NOT NULL,
  reference_id   UUID,
  reference_type TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_log_user      ON points_log(user_id);
CREATE INDEX IF NOT EXISTS idx_points_log_community ON points_log(community_id);

-- ── TELEGRAM INVITES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_invites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_id   UUID NOT NULL REFERENCES users(id),
  community_id UUID NOT NULL REFERENCES communities(id),
  invite_code  TEXT UNIQUE NOT NULL,
  invitee_id   UUID REFERENCES users(id),
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','pending','used','expired')),
  xp_awarded   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_invites_code ON telegram_invites(invite_code);

-- ── TELEGRAM LINK CODES (OTP dashboard→bot) ──────────────────
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_link_codes_code ON telegram_link_codes(code) WHERE used = FALSE;

-- ── REWARDS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rewards (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  image_url    TEXT,
  type         TEXT DEFAULT 'product' CHECK (type IN ('product','service','digital','fiat','crypto')),
  xp_cost      INTEGER NOT NULL,
  stock        INTEGER,
  is_active    BOOLEAN DEFAULT TRUE,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── REWARD CLAIMS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reward_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reward_id    UUID NOT NULL REFERENCES rewards(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  community_id UUID NOT NULL REFERENCES communities(id),
  xp_spent     INTEGER NOT NULL,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','fulfilled')),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ── LEADERBOARD VIEW ─────────────────────────────────────────
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  cm.community_id,
  cm.user_id,
  u.username,
  u.twitter_handle,
  u.avatar_url,
  cm.xp,
  RANK() OVER (PARTITION BY cm.community_id ORDER BY cm.xp DESC) AS rank,
  u.created_at AS member_since
FROM community_members cm
JOIN users u ON u.id = cm.user_id;

-- ── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON users;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON communities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON communities FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON raids;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON raids FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE raids             ENABLE ROW LEVEL SECURITY;
ALTER TABLE raid_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_log        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own"            ON users;
DROP POLICY IF EXISTS "Users update own"          ON users;
DROP POLICY IF EXISTS "Communities public read"   ON communities;
DROP POLICY IF EXISTS "Owners manage communities" ON communities;
DROP POLICY IF EXISTS "Members public read"       ON community_members;
DROP POLICY IF EXISTS "Raids public read"         ON raids;
DROP POLICY IF EXISTS "Own points log"            ON points_log;

CREATE POLICY "Users read own"            ON users FOR SELECT USING (auth.uid()::text = id::text);
CREATE POLICY "Users update own"          ON users FOR UPDATE USING (auth.uid()::text = id::text);
CREATE POLICY "Communities public read"   ON communities FOR SELECT USING (true);
CREATE POLICY "Owners manage communities" ON communities FOR ALL   USING (auth.uid()::text = owner_id::text);
CREATE POLICY "Members public read"       ON community_members FOR SELECT USING (true);
CREATE POLICY "Raids public read"        ON raids FOR SELECT USING (true);
CREATE POLICY "Own points log"           ON points_log FOR SELECT USING (auth.uid()::text = user_id::text);
