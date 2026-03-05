-- ============================================================
-- UTOPIA — Nuovi endpoint da aggiungere a backend/routes/users.js
-- Incolla questi due router.post PRIMA di module.exports
-- ============================================================

/*

// POST /api/users/telegram-code
// Genera un codice OTP e lo salva nel DB per il collegamento Telegram
router.post('/telegram-code', authenticate, async (req, res) => {
  // Genera codice 6 cifre
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // Invalida codici precedenti non usati dello stesso utente
  await supabase
    .from('telegram_link_codes')
    .update({ used: true })
    .eq('user_id', req.user.id)
    .eq('used', false);

  // Salva nuovo codice
  const { error } = await supabase
    .from('telegram_link_codes')
    .insert({ user_id: req.user.id, code });

  if (error) return res.status(500).json({ error: error.message });

  // Deep link da aprire su Telegram
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'UTOPIAbot';
  const deepLink    = `https://t.me/${botUsername}?start=link_${code}`;

  res.json({ code, deep_link: deepLink });
});


// PATCH /api/users/me/telegram
// Salva manualmente il telegram_id (metodo alternativo)
router.patch('/me/telegram', authenticate, async (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id || !/^\d{5,12}$/.test(String(telegram_id))) {
    return res.status(400).json({ error: 'telegram_id non valido' });
  }

  const { error } = await supabase
    .from('users')
    .update({ telegram_id: String(telegram_id) })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


// DELETE /api/users/me/telegram
// Scollega account Telegram
router.delete('/me/telegram', authenticate, async (req, res) => {
  await supabase
    .from('users')
    .update({ telegram_id: null, telegram_username: null })
    .eq('id', req.user.id);

  res.json({ success: true });
});

*/
