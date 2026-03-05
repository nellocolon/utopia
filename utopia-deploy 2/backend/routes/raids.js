const express = require('express');
const router = express.Router();
const Joi = require('joi');
const supabase = require('../supabase');
const { authenticate } = require('../middleware/auth');
const { verifyTwitterActions } = require('../services/twitterBot');

const raidSchema = Joi.object({
  community_id: Joi.string().uuid().required(),
  tweet_url: Joi.string().uri().required(),
  tweet_id: Joi.string().required(),
  title: Joi.string().min(3).max(120).required(),
  description: Joi.string().max(500).allow(''),
  target_likes: Joi.number().min(1).default(100),
  target_retweets: Joi.number().min(1).default(50),
  target_comments: Joi.number().min(1).default(30),
  ends_at: Joi.date().iso().allow(null)
});

const participateSchema = Joi.object({
  did_like: Joi.boolean().default(false),
  did_retweet: Joi.boolean().default(false),
  did_comment: Joi.boolean().default(false)
});

// GET /api/raids?community_id=xxx
router.get('/', authenticate, async (req, res) => {
  const { community_id } = req.query;
  let query = supabase
    .from('raids')
    .select('*, communities(name, slug)')
    .order('created_at', { ascending: false });

  if (community_id) query = query.eq('community_id', community_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/raids/:id
router.get('/:id', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('raids')
    .select('*, communities(name, slug, owner_id)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Raid not found' });

  // Add user's participation if any
  const { data: participation } = await supabase
    .from('raid_participants')
    .select('*')
    .eq('raid_id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  res.json({ ...data, my_participation: participation || null });
});

// POST /api/raids - create raid
router.post('/', authenticate, async (req, res) => {
  const { error: valErr, value } = raidSchema.validate(req.body);
  if (valErr) return res.status(400).json({ error: valErr.details[0].message });

  // Verify ownership
  const { data: community } = await supabase
    .from('communities')
    .select('id, owner_id')
    .eq('id', value.community_id)
    .single();

  if (!community || community.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Not community owner' });
  }

  const { data: raid, error } = await supabase
    .from('raids')
    .insert({ ...value, creator_id: req.user.id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Award creator XP
  await awardXP(req.user.id, value.community_id, 50, raid.id, 'raid', 'Raid creator bonus');

  // ── Telegram notification ────────────────────────────────────
  try {
    const { notifyRaidLive } = require('../services/telegramBot');
    const { data: communityFull } = await supabase
      .from('communities').select('id,name,slug,telegram_chat_id')
      .eq('id', value.community_id).single();
    await notifyRaidLive(raid, communityFull);
  } catch(e) { console.error('[TG] raid notify error:', e.message); }

  res.status(201).json(raid);
});

// POST /api/raids/:id/participate
router.post('/:id/participate', authenticate, async (req, res) => {
  const { error: valErr, value } = participateSchema.validate(req.body);
  if (valErr) return res.status(400).json({ error: valErr.details[0].message });

  // Get raid
  const { data: raid, error: raidErr } = await supabase
    .from('raids')
    .select('*')
    .eq('id', req.params.id)
    .eq('status', 'active')
    .single();

  if (raidErr || !raid) return res.status(404).json({ error: 'Raid not found or not active' });

  // Anti-fraud: simulate bot verification
  const verified = await verifyTwitterActions(
    req.user.twitter_handle || `user_${req.user.id.slice(0, 8)}`,
    raid.tweet_id,
    value
  );

  // Check for existing participation
  const { data: existing } = await supabase
    .from('raid_participants')
    .select('id')
    .eq('raid_id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  let xp_earned = 0;
  if (verified.like) xp_earned += raid.xp_like;
  if (verified.retweet) xp_earned += raid.xp_retweet;
  if (verified.comment) xp_earned += raid.xp_comment;

  const participantData = {
    raid_id: req.params.id,
    user_id: req.user.id,
    did_like: value.did_like,
    did_retweet: value.did_retweet,
    did_comment: value.did_comment,
    verified_like: verified.like,
    verified_retweet: verified.retweet,
    verified_comment: verified.comment,
    xp_earned,
    verified_at: new Date().toISOString()
  };

  if (existing) {
    await supabase.from('raid_participants').update(participantData).eq('id', existing.id);
  } else {
    await supabase.from('raid_participants').insert(participantData);
  }

  // Update raid counters
  const updates = {};
  if (verified.like && !existing) updates.current_likes = raid.current_likes + 1;
  if (verified.retweet && !existing) updates.current_retweets = raid.current_retweets + 1;
  if (verified.comment && !existing) updates.current_comments = raid.current_comments + 1;
  if (Object.keys(updates).length > 0) {
    await supabase.from('raids').update(updates).eq('id', req.params.id);
  }

  // Award XP
  if (xp_earned > 0) {
    await awardXP(req.user.id, raid.community_id, xp_earned, req.params.id, 'raid', 'Raid participation');
  }

  // Check if raid is complete
  const updatedLikes = (updates.current_likes || raid.current_likes);
  const updatedRTs = (updates.current_retweets || raid.current_retweets);
  const updatedComments = (updates.current_comments || raid.current_comments);
  if (updatedLikes >= raid.target_likes && updatedRTs >= raid.target_retweets && updatedComments >= raid.target_comments) {
    await supabase.from('raids').update({ status: 'completed' }).eq('id', req.params.id);
  }

  res.json({ xp_earned, verified, message: xp_earned > 0 ? `+${xp_earned} XP earned!` : 'Actions pending verification' });
});

// ── XP Helper ─────────────────────────────────────────────────
async function awardXP(userId, communityId, xp, refId, refType, note) {
  // Log
  await supabase.from('points_log').insert({
    user_id: userId, community_id: communityId,
    action: refType, xp_delta: xp,
    reference_id: refId, reference_type: refType, note
  });

  // Update community_members XP
  const { data: member } = await supabase
    .from('community_members')
    .select('id, xp')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .single();

  if (member) {
    await supabase.from('community_members').update({ xp: member.xp + xp }).eq('id', member.id);
  } else {
    await supabase.from('community_members').insert({ community_id: communityId, user_id: userId, xp });
  }

  // Update global total_xp
  const { data: user } = await supabase.from('users').select('total_xp').eq('id', userId).single();
  if (user) {
    await supabase.from('users').update({ total_xp: user.total_xp + xp }).eq('id', userId);
  }
}

module.exports = router;
module.exports.awardXP = awardXP;
