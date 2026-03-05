// ============================================================
// UTOPIA — Telegram Bot Service (Multi-Tenant)
// ============================================================
// Un bot singolo che serve TUTTE le community UTOPIA.
//
// Flusso registrazione automatica:
//  1. Creator linka il suo Telegram nel dashboard (salva owner_telegram_id)
//  2. Creator aggiunge @UTOPIAbot al gruppo come admin
//  3. Bot riceve my_chat_member → trova community owner → salva chat_id
//  4. Da quel momento gestisce raid alerts e comandi per quella community
// ============================================================

const supabase  = require('../supabase');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FRONTEND  = process.env.FRONTEND_URL || 'https://utopia.io';
const API_URL   = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Primitiva invio ──────────────────────────────────────────
async function sendMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`${API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
      })
    });
    return await res.json();
  } catch (e) {
    console.error('[TG] sendMessage error:', e.message);
    return null;
  }
}

// ── DB helpers ───────────────────────────────────────────────
async function getCommunityByChat(chatId) {
  const { data } = await supabase
    .from('communities')
    .select('id, name, slug, status')
    .eq('telegram_chat_id', String(chatId))
    .eq('status', 'active')
    .single();
  return data || null;
}

async function getUserByTelegramId(telegramId) {
  const { data } = await supabase
    .from('users')
    .select('id, username, total_xp')
    .eq('telegram_id', String(telegramId))
    .single();
  return data || null;
}

// ════════════════════════════════════════════════════════════
// REGISTRAZIONE AUTOMATICA DEL GRUPPO
// ════════════════════════════════════════════════════════════
async function handleBotJoinedGroup(update) {
  const event     = update.my_chat_member;
  const newStatus = event.new_chat_member?.status;
  const chat      = event.chat;
  const from      = event.from;

  if (!['member', 'administrator'].includes(newStatus)) return;
  if (!['group', 'supergroup'].includes(chat.type)) return;

  const chatId    = chat.id;
  const chatTitle = chat.title;

  console.log(`[TG] Bot aggiunto a "${chatTitle}" (${chatId}) da TG user ${from.id}`);

  // Trova la community il cui owner ha questo telegram_id
  // e non ha ancora un gruppo collegato
  const { data: community } = await supabase
    .from('communities')
    .select('id, name, slug, telegram_chat_id')
    .eq('owner_telegram_id', String(from.id))
    .is('telegram_chat_id', null)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!community) {
    await sendMessage(chatId,
      `👋 Sono il bot di <b>UTOPIA</b>.\n\n` +
      `Per attivare il bot in questo gruppo, il creator deve:\n` +
      `1. Registrarsi su ${FRONTEND}\n` +
      `2. Collegare il suo Telegram ID nel dashboard → Settings\n` +
      `3. Riaggiungermi al gruppo come admin\n\n` +
      `<i>Già registrato? Assicurati che il tuo Telegram ID sia salvato in Settings.</i>`
    );
    return;
  }

  // ✅ Salva il chat_id — la community è ora attiva su Telegram
  await supabase
    .from('communities')
    .update({
      telegram_chat_id:    String(chatId),
      telegram_chat_title: chatTitle,
      telegram_linked_at:  new Date().toISOString()
    })
    .eq('id', community.id);

  console.log(`[TG] ✅ Community "${community.name}" → chat ${chatId}`);

  await sendMessage(chatId,
    `🚀 <b>UTOPIA attivo per "${community.name}"!</b>\n\n` +
    `Gestisco:\n` +
    `⚔️ Notifiche raid in tempo reale\n` +
    `⭐ XP e aggiornamenti classifica\n` +
    `📊 Recap settimanale\n\n` +
    `Comandi:\n` +
    `/xp · /referral · /leaderboard · /raids · /quests\n\n` +
    `🌐 ${FRONTEND}/c/${community.slug}`
  );
}

// ════════════════════════════════════════════════════════════
// COMANDI NEI GRUPPI
// ════════════════════════════════════════════════════════════
async function handleGroupCommand(msg) {
  const chatId    = msg.chat?.id;
  const from      = msg.from;
  const community = await getCommunityByChat(chatId);
  if (!community) return;

  const cmd = msg.text.split(' ')[0].split('@')[0];

  // /xp
  if (cmd === '/xp') {
    const user = await getUserByTelegramId(from.id);
    if (!user) {
      return sendMessage(chatId,
        `@${from.username || from.first_name}, collega il tuo Telegram su ${FRONTEND}/dashboard → Settings`,
        { reply_to_message_id: msg.message_id }
      );
    }
    const { data: member } = await supabase
      .from('community_members')
      .select('xp, rank')
      .eq('community_id', community.id)
      .eq('user_id', user.id)
      .single();

    await sendMessage(chatId,
      `⭐ <b>${user.username}</b>\n` +
      `XP in <i>${community.name}</i>: <b>${(member?.xp || 0).toLocaleString()} XP</b>\n` +
      `Rank: <b>#${member?.rank || '—'}</b>\n` +
      `XP totale: ${user.total_xp.toLocaleString()}`,
      { reply_to_message_id: msg.message_id }
    );
  }

  // /referral
  if (cmd === '/referral') {
    const user = await getUserByTelegramId(from.id);
    if (!user) {
      return sendMessage(chatId,
        `Collega il tuo account su ${FRONTEND}/dashboard → Settings per ottenere il link referral.`,
        { reply_to_message_id: msg.message_id }
      );
    }
    let { data: invite } = await supabase
      .from('telegram_invites')
      .select('invite_code')
      .eq('user_id', user.id)
      .eq('community_id', community.id)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (!invite) {
      const code = `utopia_${community.slug}_${user.id.slice(0, 8)}`;
      await supabase.from('telegram_invites').insert({
        invite_code: code, user_id: user.id,
        community_id: community.id, status: 'active'
      });
      invite = { invite_code: code };
    }

    await sendMessage(chatId,
      `🔗 <b>${user.username}</b>, il tuo link referral:\n\n` +
      `${FRONTEND}/join/${community.slug}?ref=${invite.invite_code}\n\n` +
      `Guadagni <b>+100 XP</b> per ogni membro che si iscrive! 🚀`,
      { reply_to_message_id: msg.message_id }
    );
  }

  // /leaderboard
  if (cmd === '/leaderboard') {
    const { data: top } = await supabase
      .from('community_members')
      .select('xp, users(username)')
      .eq('community_id', community.id)
      .order('xp', { ascending: false })
      .limit(10);

    if (!top?.length) {
      return sendMessage(chatId, `Nessun membro in classifica per <i>${community.name}</i> ancora.`);
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines  = top.map((m, i) =>
      `${medals[i] || `${i + 1}.`} <b>${m.users?.username || 'Unknown'}</b> — ${m.xp.toLocaleString()} XP`
    ).join('\n');

    await sendMessage(chatId,
      `🏆 <b>Top 10 — ${community.name}</b>\n\n${lines}\n\n` +
      `${FRONTEND}/c/${community.slug}/leaderboard`
    );
  }

  // /raids
  if (cmd === '/raids') {
    const { data: raids } = await supabase
      .from('raids')
      .select('title, tweet_url, current_likes, target_likes, xp_like, xp_retweet, xp_comment')
      .eq('community_id', community.id)
      .eq('status', 'active')
      .limit(3);

    if (!raids?.length) {
      return sendMessage(chatId, `Nessun raid attivo in <i>${community.name}</i>. Torna presto! 👀`);
    }
    const lines = raids.map(r => {
      const pct = Math.round((r.current_likes / Math.max(r.target_likes, 1)) * 100);
      return `⚔️ <b>${r.title}</b>\nProgresso: ${pct}% · Like +${r.xp_like} · RT +${r.xp_retweet} · Reply +${r.xp_comment} XP\n🔗 ${r.tweet_url}`;
    }).join('\n\n');

    await sendMessage(chatId, `⚔️ <b>Raid attivi — ${community.name}</b>\n\n${lines}`);
  }

  // /quests
  if (cmd === '/quests') {
    const { data: quests } = await supabase
      .from('quests')
      .select('title, xp_reward, description')
      .eq('community_id', community.id)
      .eq('is_active', true)
      .order('xp_reward', { ascending: false })
      .limit(5);

    if (!quests?.length) {
      return sendMessage(chatId, `Nessuna quest attiva per <i>${community.name}</i> oggi.`);
    }
    const lines = quests.map(q =>
      `🎯 <b>${q.title}</b> — +${q.xp_reward} XP\n<i>${q.description || ''}</i>`
    ).join('\n\n');

    await sendMessage(chatId,
      `🎯 <b>Quest — ${community.name}</b>\n\n${lines}\n\n${FRONTEND}/dashboard`
    );
  }
}

// ════════════════════════════════════════════════════════════
// LINK OTP: collega account UTOPIA ↔ Telegram
// ════════════════════════════════════════════════════════════
async function handleLinkCode(msg, code) {
  const telegramId  = String(msg.from.id);
  const telegramUser = msg.from.username || msg.from.first_name;

  // Trova il codice OTP valido nel DB (scadenza 10 min)
  const expiry = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pending } = await supabase
    .from('telegram_link_codes')
    .select('user_id')
    .eq('code', code)
    .eq('used', false)
    .gte('created_at', expiry)
    .single();

  if (!pending) {
    return sendMessage(msg.chat.id,
      `❌ Codice non valido o scaduto.\n\nTorna su ${FRONTEND}/dashboard → Settings e genera un nuovo codice.`
    );
  }

  // Salva telegram_id sull'utente e segna il codice come usato
  await supabase
    .from('users')
    .update({ telegram_id: telegramId, telegram_username: telegramUser })
    .eq('id', pending.user_id);

  await supabase
    .from('telegram_link_codes')
    .update({ used: true })
    .eq('code', code);

  await sendMessage(msg.chat.id,
    `✅ <b>Account collegato!</b>\n\n` +
    `Il tuo Telegram è ora associato al tuo account UTOPIA.\n\n` +
    `Passo successivo: aggiungi <b>@UTOPIAbot</b> al tuo gruppo Telegram come amministratore per attivare il bot sulla tua community.`
  );
}

// ════════════════════════════════════════════════════════════
// CHAT PRIVATA con il bot
// ════════════════════════════════════════════════════════════
async function handlePrivateMessage(msg) {
  const text = msg.text || '';
  const chatId = msg.chat.id;

  if (!text.startsWith('/start')) return;

  const param = text.split(' ')[1] || '';

  // /start link_CODICE → collega account
  if (param.startsWith('link_')) {
    const code = param.replace('link_', '');
    return handleLinkCode(msg, code);
  }

  // /start utopia_SLUG_USERID → referral invite
  if (param.startsWith('utopia_')) {
    const { data: invite } = await supabase
      .from('telegram_invites')
      .select('*, communities(name, slug)')
      .eq('invite_code', param)
      .eq('status', 'active')
      .single();

    if (invite) {
      return sendMessage(chatId,
        `🎉 Sei stato invitato a <b>${invite.communities?.name}</b>!\n\n` +
        `Registrati con il codice <code>${param}</code> per +25 XP bonus:\n` +
        `${FRONTEND}/join/${invite.communities?.slug}?ref=${param}`
      );
    }
  }

  // Default /start
  await sendMessage(chatId,
    `🚀 <b>Benvenuto su UTOPIA!</b>\n\n` +
    `La piattaforma di community engagement per progetti Web3 e crypto.\n\n` +
    `Per collegare il tuo account:\n` +
    `1. Vai su ${FRONTEND}/dashboard → Settings\n` +
    `2. Clicca "Open @UTOPIAbot" per generare il tuo codice\n` +
    `3. Inviamelo e saremo collegati!\n\n` +
    `🌐 ${FRONTEND}`
  );
}

// ════════════════════════════════════════════════════════════
// ENTRY POINT PUBBLICO
// ════════════════════════════════════════════════════════════

/** Processa un update Telegram — chiamato da routes/bot.js */
async function processUpdate(update) {
  try {
    if (update.my_chat_member)                              { await handleBotJoinedGroup(update); return; }
    const msg = update.message;
    if (!msg?.text) return;
    const type = msg.chat?.type;
    if (type === 'private')                                 { await handlePrivateMessage(msg); return; }
    if (['group','supergroup'].includes(type) && msg.text.startsWith('/')) {
      await handleGroupCommand(msg);
    }
  } catch (err) {
    console.error('[TG] processUpdate error:', err.message);
  }
}

/** Notifica raid live — chiamato da routes/raids.js */
async function notifyRaidLive(raid, community) {
  if (!community?.telegram_chat_id) return;
  await sendMessage(community.telegram_chat_id,
    `⚔️ <b>RAID LIVE!</b>\n\n` +
    `<b>${raid.title}</b>\n\n` +
    `👍 Like → <b>+${raid.xp_like} XP</b>\n` +
    `🔁 Retweet → <b>+${raid.xp_retweet} XP</b>\n` +
    `💬 Reply → <b>+${raid.xp_comment} XP</b>\n\n` +
    `🎯 Obiettivo: ${raid.target_likes} like · ${raid.target_retweets} RT · ${raid.target_comments} reply\n\n` +
    `🔗 ${raid.tweet_url}`
  );
}

/** Notifica raid completato */
async function notifyRaidCompleted(raid, community) {
  if (!community?.telegram_chat_id) return;
  await sendMessage(community.telegram_chat_id,
    `🏁 <b>RAID COMPLETATO!</b>\n\n` +
    `"${raid.title}" ha raggiunto tutti gli obiettivi! 🎉\n` +
    `Classifica: ${FRONTEND}/c/${community.slug}/leaderboard`
  );
}

/** Notifica rank up di un utente */
async function notifyRankUp(username, community, newRank, oldRank) {
  if (!community?.telegram_chat_id || newRank >= oldRank) return;
  const emoji = newRank === 1 ? '🥇' : newRank === 2 ? '🥈' : newRank === 3 ? '🥉' : '📈';
  await sendMessage(community.telegram_chat_id,
    `${emoji} <b>${username}</b> è salito al <b>#${newRank}</b>! <i>(era #${oldRank})</i>`
  );
}

/** Recap settimanale — callable da cron */
async function sendWeeklyRecap(communityId) {
  const { data: community } = await supabase
    .from('communities')
    .select('id, name, slug, telegram_chat_id')
    .eq('id', communityId).single();

  if (!community?.telegram_chat_id) return;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: top } = await supabase
    .from('points_log')
    .select('user_id, users(username), xp_delta')
    .eq('community_id', communityId)
    .gte('created_at', weekAgo)
    .order('xp_delta', { ascending: false })
    .limit(3);

  const medals   = ['🥇', '🥈', '🥉'];
  const topLines = (top || []).map((r, i) =>
    `${medals[i]} ${r.users?.username || 'Unknown'}`
  ).join('\n') || 'Nessun dato questa settimana';

  await sendMessage(community.telegram_chat_id,
    `📊 <b>Weekly Recap — ${community.name}</b>\n\n` +
    `🏆 Top performers:\n${topLines}\n\n` +
    `Nuova settimana, nuovi raid! 🚀\n${FRONTEND}/c/${community.slug}/leaderboard`
  );
}

/** Setup webhook — chiamato da server.js all'avvio */
async function setupWebhook(backendUrl) {
  if (!BOT_TOKEN) { console.log('[TG] Bot disabilitato (no TELEGRAM_BOT_TOKEN)'); return; }
  try {
    const res = await fetch(`${API_URL}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${backendUrl}/api/bot/webhook`,
        allowed_updates: ['message', 'callback_query', 'my_chat_member'],
        drop_pending_updates: true
      })
    });
    const d = await res.json();
    console.log(d.ok ? `[TG] ✅ Webhook: ${backendUrl}/api/bot/webhook` : `[TG] ❌ ${d.description}`);
  } catch (e) { console.error('[TG] setupWebhook error:', e.message); }
}

module.exports = { processUpdate, setupWebhook, notifyRaidLive, notifyRaidCompleted, notifyRankUp, sendWeeklyRecap, sendMessage };
