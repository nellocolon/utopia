const express = require('express');
const router = express.Router();
const Joi = require('joi');
const supabase = require('../supabase');
const { authenticate } = require('../middleware/auth');

const communitySchema = Joi.object({
  name: Joi.string().min(2).max(80).required(),
  slug: Joi.string().alphanum().min(2).max(40).required(),
  description: Joi.string().max(500).allow(''),
  logo_url: Joi.string().uri().allow(''),
  twitter_handle: Joi.string().max(50).allow(''),
  telegram_group_id: Joi.number().allow(null),
  display_mode: Joi.string().valid('page', 'iframe', 'plugin').default('page'),
  reward_type: Joi.string().valid('fiat', 'products', 'crypto').default('fiat')
});

// GET /api/communities - list owned communities
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('communities')
    .select('*, community_members(count)')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/communities/:slug - public community page
router.get('/:slug', async (req, res) => {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, slug, description, logo_url, twitter_handle, display_mode, member_count, status, created_at')
    .eq('slug', req.params.slug)
    .eq('status', 'active')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Community not found' });
  res.json(data);
});

// POST /api/communities - create
router.post('/', authenticate, async (req, res) => {
  const { error: valErr, value } = communitySchema.validate(req.body);
  if (valErr) return res.status(400).json({ error: valErr.details[0].message });

  const { data, error } = await supabase
    .from('communities')
    .insert({ ...value, owner_id: req.user.id })
    .select()
    .single();

  if (error) {
    if (error.message?.includes('Maximum of 25')) {
      return res.status(400).json({ error: 'Maximum of 25 active communities reached' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Slug already taken' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PUT /api/communities/:id - update
router.put('/:id', authenticate, async (req, res) => {
  const { error: valErr, value } = communitySchema.validate(req.body);
  if (valErr) return res.status(400).json({ error: valErr.details[0].message });

  const { data, error } = await supabase
    .from('communities')
    .update(value)
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Community not found or unauthorized' });
  res.json(data);
});

// DELETE /api/communities/:id - archive
router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('communities')
    .update({ status: 'archived' })
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Community archived' });
});

// POST /api/communities/:id/join - join a community
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

  // Increment member count
  await supabase.rpc('increment', { table: 'communities', col: 'member_count', id: req.params.id });

  res.status(201).json({ message: 'Joined community' });
});

module.exports = router;
