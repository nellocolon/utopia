-- ============================================================
-- UTOPIA — 04_telegram_multi_tenant.sql
-- Esegui per QUARTO nel SQL Editor di Supabase
-- DOPO aver eseguito 01, 02, 03
-- (Questo file è quasi tutto già incluso nel 01 —
--  serve solo come verifica di sicurezza e non produrrà errori)
-- ============================================================

-- Tutte le colonne Telegram sono già nel file 01.
-- Questo file aggiunge solo gli indici mancanti con IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_communities_telegram_chat_id
  ON communities(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_communities_owner_telegram_id
  ON communities(owner_telegram_id) WHERE owner_telegram_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_telegram_id
  ON users(telegram_id) WHERE telegram_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_link_codes_code
  ON telegram_link_codes(code) WHERE used = FALSE;
