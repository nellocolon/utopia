-- ============================================================
-- UTOPIA — 03_ads_procedures.sql
-- Esegui per TERZO nel SQL Editor di Supabase
-- DOPO aver eseguito 01 e 02
-- ============================================================

-- ── Upsert IP rate counter ───────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_ip_rate(p_ip_hash TEXT, p_window_start TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ip_ad_rate (ip_hash, window_start, view_count)
  VALUES (p_ip_hash, p_window_start, 1)
  ON CONFLICT (ip_hash, window_start)
  DO UPDATE SET view_count = ip_ad_rate.view_count + 1;
END;
$$;

-- ── Increment user points atomically ─────────────────────────
CREATE OR REPLACE FUNCTION increment_user_points(p_user_id UUID, p_delta INT, p_date DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET
    daily_points    = daily_points + p_delta,
    last_claim_date = p_date,
    updated_at      = NOW()
  WHERE id = p_user_id;
END;
$$;

-- ── Increment creator ad view counters ───────────────────────
CREATE OR REPLACE FUNCTION increment_creator_ad_views(p_ad_id UUID, p_revenue NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE creator_ads SET
    total_views      = total_views + 1,
    verified_views   = verified_views + 1,
    revenue_estimate = revenue_estimate + p_revenue
  WHERE id = p_ad_id;
END;
$$;

-- ── Increment community cumulative ad views ──────────────────
CREATE OR REPLACE FUNCTION increment_community_ad_views(p_community_id UUID)
RETURNS TABLE (cumulative_creator_ad_views INT, milestone_threshold INT)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE communities SET
    cumulative_creator_ad_views = cumulative_creator_ad_views + 1,
    updated_at                  = NOW()
  WHERE id = p_community_id;

  RETURN QUERY
  SELECT c.cumulative_creator_ad_views, c.milestone_threshold
  FROM communities c WHERE c.id = p_community_id;
END;
$$;

-- ── Admin: manual view adjustment ────────────────────────────
CREATE OR REPLACE FUNCTION admin_adjust_community_views(
  p_community_id UUID, p_delta INT, p_admin_id UUID
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE communities SET
    cumulative_creator_ad_views = GREATEST(0, cumulative_creator_ad_views + p_delta),
    updated_at                  = NOW()
  WHERE id = p_community_id;
END;
$$;

-- ── Cleanup old IP rate records ───────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_ip_rate_old()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM ip_ad_rate WHERE window_start < NOW() - INTERVAL '2 hours';
END;
$$;
