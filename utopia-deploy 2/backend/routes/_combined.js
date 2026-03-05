// ── Leaderboard ───────────────────────────────────────────────
const express = require('express');
const leaderboardRouter = express.Router();
const supabase = require('../supabase');
const { authenticate } = require('../middleware/auth');

leaderboardRouter.get('/:community_id', async (req, res) => {
  const { community_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .eq('community_id', community_id)
    .order('xp', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports.leaderboardRouter = leaderboardRouter;

// ── Rewards ───────────────────────────────────────────────────
const rewardsRouter = express.Router();

rewardsRouter.get('/', authenticate, async (req, res) => {
  const { community_id } = req.query;
  let query = supabase.from('rewards').select('*').eq('is_active', true);
  if (community_id) query = query.eq('community_id', community_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

rewardsRouter.post('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('rewards')
    .insert({ ...req.body })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

rewardsRouter.post('/:id/claim', authenticate, async (req, res) => {
  const { community_id } = req.body;
  const { data: reward } = await supabase.from('rewards').select('*').eq('id', req.params.id).single();
  if (!reward) return res.status(404).json({ error: 'Reward not found' });

  const { data: member } = await supabase
    .from('community_members')
    .select('xp')
    .eq('community_id', community_id)
    .eq('user_id', req.user.id)
    .single();

  if (!member || member.xp < reward.xp_cost) {
    return res.status(400).json({ error: 'Not enough XP' });
  }

  const { data: claim, error } = await supabase
    .from('reward_claims')
    .insert({ reward_id: req.params.id, user_id: req.user.id, community_id, xp_spent: reward.xp_cost })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Deduct XP
  await supabase.from('community_members').update({ xp: member.xp - reward.xp_cost })
    .eq('community_id', community_id).eq('user_id', req.user.id);

  await supabase.from('points_log').insert({
    user_id: req.user.id, community_id,
    action: 'reward_claim', xp_delta: -reward.xp_cost,
    reference_id: claim.id, reference_type: 'reward', note: `Claimed: ${reward.name}`
  });

  res.json({ message: 'Reward claimed! Admin will process shortly.', claim });
});

module.exports.rewardsRouter = rewardsRouter;

// ── Users ─────────────────────────────────────────────────────
const usersRouter = express.Router();

usersRouter.get('/profile', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, email, twitter_handle, telegram_id, avatar_url, total_xp, created_at')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

usersRouter.put('/profile', authenticate, async (req, res) => {
  const allowed = ['twitter_handle', 'telegram_id', 'avatar_url'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.user.id)
    .select('id, username, email, twitter_handle, telegram_id, avatar_url, total_xp').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

usersRouter.get('/xp-history', authenticate, async (req, res) => {
  const { community_id } = req.query;
  let query = supabase.from('points_log').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
  if (community_id) query = query.eq('community_id', community_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports.usersRouter = usersRouter;
