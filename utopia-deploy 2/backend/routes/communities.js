const express = require('express');
const router  = express.Router();
const Joi     = require('joi');
const supabase = require('../supabase');
const { authenticate } = require('../middleware/auth');

// ── Validation schema ─────────────────────────────────────────
const communitySchema = Joi.object({
  name:          Joi.string().min(2).max(80).required(),
  slug:          Joi.string().pattern(/^[a-z0-9-]+$/).min(2).max(40).required(),
  description:   Joi.string().max(500).allow(''),
  logo_url:      Joi.string().uri().allow(''),
  cover_url:     Joi.string().uri().allow(''),
  twitter_handle: Joi.string().max(50).allow(''),
  display_mode:  Joi.string().valid('page','iframe','plugin').default('page'),

  // social links (nested object, all optional)
  telegram_url:  Joi.string().uri().allow(''),
  discord_url:   Joi.string().uri().allow(''),
  instagram_url: Joi.string().uri().allow(''),
  website_url:   Joi.string().uri().allow(''),

  // reward system
  reward_types: Joi.array()
    .items(Joi.string().valid('giftcard','cash','products','digital','crypto','airdrop','nft','services'))
    .min(1)
    .default(['giftcard']),
  reward_modes: Joi.object({
    xp_redemption: Joi.boolean().default(true),
    ranking:       Joi.boolean().default(false)
  }).default({ xp_redemption: true, ranking: false }),

  // legacy field kept for backward compat
  reward_type: Joi.string()
    .valid('fiat','products','crypto','mixed','airdrop','nft','services','giftcard')
    .default('giftcard'),

  // announcement
  announcement:      Joi.string().max(1000).allow(''),
  announcement_date: Joi.string().isoDate().allow('', null)
});

// ── GET / — list creator's communities ───────────────────────
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('communities')
    .select('*, community_members(count)')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /:slug — public community page ───────────────────────
router.get('/:slug', async (req, res) => {
  const { data, error } = await supabase
    .from('communities')
    .select(`
      id, name, slug, description, logo_url, cover_url,
      twitter_handle, social_links, announcement, announcement_date,
      display_mode, reward_modes, reward_types, reward_type,
      member_count, status, created_at
    `)
    .eq('slug', req.params.slug)
    .eq('status', 'active')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Community not found' });
  res.json(data);
});

// ── POST / — create community ─────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { error: valErr, value } = communitySchema.validate(req.body);
  if (valErr) return res.status(400).json({ error: valErr.details[0].message });

  // Build social_links JSONB from flat fields
  const social_links = {};
  if (value.telegram_url)  social_links.telegram_url  = value.telegram_url;
  if (value.discord_url)   social_links.discord_url   = value.discord_url;
  if (value.instagram_url) social_links.instagram_url = value.instagram_url;
  if (value.website_url)   social_links.website_url   = value.website_url;
  if (value.twitter_handle) social_links.twitter = `https://x.com/${value.twitter_handle}`;

  const { telegram_url, discord_url, instagram_url, website_url, ...rest } = value;

  const { data, error } = await supabase
    .from('communities')
    .insert({ ...rest, owner_id: req.user.id, social_links })
    .select()
    .single();

  if (error) {
    if (error.message?.includes('Maximum of 25'))
      return res.status(400).json({ error: 'Maximum of 25 active communities reached' });
    if (error.code === '23505')
      return res.status(409).json({ error: 'Slug already taken' });
    return res.status(500).json({ error: error.message });
  }

  // Auto-create Season 1 if ranking mode is enabled
  if (value.reward_modes?.ranking) {
    await supabase.from('community_seasons').insert({
      community_id: data.id,
      name: 'Season 1',
      starts_at: new Date().toISOString()
    });
  }

  res.status(201).json(data);
});

// ── PUT /:id — update community ───────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  const { error: valErr, value } = communitySchema.validate(req.body);
  if (valErr) return res.status(400).json({ error: valErr.details[0].message });

  // Rebuild social_links if any social field provided
  const socialFields = ['telegram_url','discord_url','instagram_url','website_url'];
  const hasSocialUpdate = socialFields.some(f => value[f] !== undefined);
  let extra = {};
  if (hasSocialUpdate) {
    const { data: existing } = await supabase
      .from('communities').select('social_links').eq('id', req.params.id).single();
    const current = existing?.social_links || {};
    socialFields.forEach(f => { if (value[f] !== undefined) current[f] = value[f]; });
    if (value.twitter_handle) current.twitter = `https://x.com/${value.twitter_handle}`;
    extra.social_links = current;
  }

  const { telegram_url, discord_url, instagram_url, website_url, ...rest } = value;

  const { data, error } = await supabase
    .from('communities')
    .update({ ...rest, ...extra })
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .select()
    .single();

  if (error || !data)
    return res.status(404).json({ error: 'Community not found or unauthorized' });
  res.json(data);
});

// ── DELETE /:id — archive ─────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('communities')
    .update({ status: 'archived' })
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Community archived' });
});

// ── POST /:id/join ────────────────────────────────────────────
router.post('/:id/join', authenticate, async (req, res) => {
  const { data: existing } = await supabase
    .from('community_members')
    .select('id')
    .eq('community_id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (existing) return res.status(409).json({ error: 'Already a member' });

  const { error } = await supabase
    .from('community_members')
    .insert({ community_id: req.params.id, user_id: req.user.id });

  if (error) return res.status(500).json({ error: error.message });

  await supabase.rpc('increment', {
    table: 'communities', col: 'member_count', id: req.params.id
  });

  res.status(201).json({ message: 'Joined community' });
});

// ── GET /:id/ranking-prizes — premi classifica ───────────────
router.get('/:id/ranking-prizes', async (req, res) => {
  const { data, error } = await supabase
    .from('ranking_prizes')
    .select('*')
    .eq('community_id', req.params.id)
    .eq('is_active', true)
    .order('position_from');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /:id/ranking-prizes — crea premio classifica ────────
router.post('/:id/ranking-prizes', authenticate, async (req, res) => {
  // Verify ownership
  const { data: comm } = await supabase
    .from('communities').select('owner_id').eq('id', req.params.id).single();
  if (!comm || comm.owner_id !== req.user.id)
    return res.status(403).json({ error: 'Unauthorized' });

  const { position_from, position_to, name, description, type, value_display } = req.body;
  if (!position_from || !name || !type)
    return res.status(400).json({ error: 'position_from, name and type are required' });

  const { data, error } = await supabase
    .from('ranking_prizes')
    .insert({
      community_id:  req.params.id,
      position_from: parseInt(position_from),
      position_to:   parseInt(position_to || position_from),
      name, description, type,
      value_display
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── DELETE /:id/ranking-prizes/:prizeId ──────────────────────
router.delete('/:id/ranking-prizes/:prizeId', authenticate, async (req, res) => {
  const { data: comm } = await supabase
    .from('communities').select('owner_id').eq('id', req.params.id).single();
  if (!comm || comm.owner_id !== req.user.id)
    return res.status(403).json({ error: 'Unauthorized' });

  await supabase.from('ranking_prizes')
    .update({ is_active: false })
    .eq('id', req.params.prizeId)
    .eq('community_id', req.params.id);

  res.json({ message: 'Prize removed' });
});

module.exports = router;
