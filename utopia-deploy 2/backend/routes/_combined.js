// ── Leaderboard ───────────────────────────────────────────────
const express    = require('express');
const supabase   = require('../supabase');
const { authenticate } = require('../middleware/auth');

const leaderboardRouter = express.Router();

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

// GET /api/rewards?community_id=X[&mode=xp|ranking]
rewardsRouter.get('/', authenticate, async (req, res) => {
  const { community_id, mode } = req.query;
  let query = supabase.from('rewards').select('*').eq('is_active', true);
  if (community_id) query = query.eq('community_id', community_id);
  if (mode && ['xp','ranking','both'].includes(mode))
    query = query.in('reward_mode', mode === 'xp' ? ['xp','both'] : mode === 'ranking' ? ['ranking','both'] : ['xp','ranking','both']);
  query = query.order('xp_cost', { ascending: true });
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/rewards — create reward (owner only)
rewardsRouter.post('/', authenticate, async (req, res) => {
  const {
    community_id, name, description, image_url,
    type, xp_cost, stock, metadata, reward_mode
  } = req.body;

  // Verify ownership
  const { data: comm } = await supabase
    .from('communities').select('owner_id').eq('id', community_id).single();
  if (!comm || comm.owner_id !== req.user.id)
    return res.status(403).json({ error: 'Unauthorized' });

  if (!name || !type || (reward_mode !== 'ranking' && !xp_cost))
    return res.status(400).json({ error: 'name, type and xp_cost are required' });

  const { data, error } = await supabase
    .from('rewards')
    .insert({
      community_id, name, description, image_url,
      type, xp_cost: xp_cost || 0, stock,
      metadata: metadata || {},
      reward_mode: reward_mode || 'xp',
      is_active: true
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/rewards/:id/claim — XP-based claim
rewardsRouter.post('/:id/claim', authenticate, async (req, res) => {
  const { community_id } = req.body;

  const { data: reward } = await supabase
    .from('rewards').select('*').eq('id', req.params.id).single();
  if (!reward) return res.status(404).json({ error: 'Reward not found' });
  if (!reward.is_active) return res.status(400).json({ error: 'Reward no longer available' });
  if (reward.reward_mode === 'ranking')
    return res.status(400).json({ error: 'This reward is assigned by ranking, not XP redemption' });

  // Check member XP
  const { data: member } = await supabase
    .from('community_members')
    .select('xp')
    .eq('community_id', community_id)
    .eq('user_id', req.user.id)
    .single();

  if (!member) return res.status(400).json({ error: 'You are not a member of this community' });
  if (member.xp < reward.xp_cost)
    return res.status(400).json({ error: `Not enough XP. Need ${reward.xp_cost}, you have ${member.xp}` });

  // Check stock
  if (reward.stock !== null && reward.stock <= 0)
    return res.status(400).json({ error: 'Reward out of stock' });

  // Create claim
  const { data: claim, error } = await supabase
    .from('reward_claims')
    .insert({
      reward_id: req.params.id,
      user_id: req.user.id,
      community_id,
      xp_spent: reward.xp_cost,
      claim_type: 'xp',
      status: 'pending'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Deduct XP
  await supabase.from('community_members')
    .update({ xp: member.xp - reward.xp_cost })
    .eq('community_id', community_id)
    .eq('user_id', req.user.id);

  // Log
  await supabase.from('points_log').insert({
    user_id: req.user.id, community_id,
    action: 'reward_claim',
    xp_delta: -reward.xp_cost,
    reference_id: claim.id,
    reference_type: 'reward',
    note: `Riscattato: ${reward.name}`
  });

  // Decrement stock if finite
  if (reward.stock !== null) {
    await supabase.from('rewards')
      .update({ stock: reward.stock - 1 })
      .eq('id', req.params.id);
  }

  res.json({ message: 'Reward claimed! The admin will process it shortly.', claim });
});

// GET /api/rewards/claims?community_id=X — admin view of pending claims
rewardsRouter.get('/claims', authenticate, async (req, res) => {
  const { community_id, status } = req.query;
  let query = supabase
    .from('reward_claims')
    .select('*, rewards(name,type), users(username,email,twitter_handle)')
    .order('created_at', { ascending: false });
  if (community_id) query = query.eq('community_id', community_id);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/rewards/claims/:id — admin approve/reject
rewardsRouter.put('/claims/:id', authenticate, async (req, res) => {
  const { status, notes } = req.body;
  if (!['approved','rejected','fulfilled'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  const { data, error } = await supabase
    .from('reward_claims')
    .update({ status, notes, processed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  let query = supabase
    .from('points_log').select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (community_id) query = query.eq('community_id', community_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports.usersRouter = usersRouter;
