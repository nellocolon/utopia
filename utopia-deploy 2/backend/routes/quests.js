const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { authenticate } = require('../middleware/auth');
const { awardXP } = require('./raids');

// GET /api/quests?community_id=xxx - get quests for community
router.get('/', authenticate, async (req, res) => {
  const { community_id } = req.query;
  if (!community_id) return res.status(400).json({ error: 'community_id required' });

  // Get quest templates (global + community-specific)
  const { data: templates } = await supabase
    .from('quest_templates')
    .select('*')
    .or(`community_id.eq.${community_id},community_id.is.null`)
    .eq('is_active', true);

  // Get user's completions for this community
  const { data: completions } = await supabase
    .from('user_quest_completions')
    .select('quest_instance_id, completed_at, xp_awarded')
    .eq('user_id', req.user.id)
    .eq('community_id', community_id);

  // Get active instances
  const { data: instances } = await supabase
    .from('quest_instances')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('community_id', community_id);

  const completionsByTemplate = {};
  if (completions) {
    for (const c of completions) completionsByTemplate[c.quest_instance_id] = c;
  }

  res.json({ templates: templates || [], instances: instances || [], completions: completions || [] });
});

// POST /api/quests/:template_id/complete - complete a quest
router.post('/:template_id/complete', authenticate, async (req, res) => {
  const { community_id } = req.body;
  if (!community_id) return res.status(400).json({ error: 'community_id required' });

  // Get template
  const { data: template } = await supabase
    .from('quest_templates')
    .select('*')
    .eq('id', req.params.template_id)
    .eq('is_active', true)
    .single();

  if (!template) return res.status(404).json({ error: 'Quest not found' });

  // Check if already completed today (for daily quests)
  if (template.type === 'daily') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: todayCompletion } = await supabase
      .from('user_quest_completions')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('community_id', community_id)
      .gte('completed_at', today.toISOString())
      .limit(1)
      .single();

    if (todayCompletion) {
      return res.status(409).json({ error: 'Quest already completed today' });
    }
  }

  // Check max completions
  if (template.max_completions) {
    const { count } = await supabase
      .from('user_quest_completions')
      .select('id', { count: 'exact' })
      .eq('user_id', req.user.id)
      .eq('community_id', community_id);

    if (count >= template.max_completions) {
      return res.status(409).json({ error: 'Quest already completed maximum times' });
    }
  }

  // Create instance and completion
  const { data: instance } = await supabase
    .from('quest_instances')
    .insert({
      template_id: template.id,
      community_id,
      user_id: req.user.id,
      status: 'completed',
      xp_awarded: template.xp_reward,
      completed_at: new Date().toISOString()
    })
    .select()
    .single();

  await supabase.from('user_quest_completions').insert({
    user_id: req.user.id,
    quest_instance_id: instance.id,
    community_id,
    xp_awarded: template.xp_reward
  });

  await awardXP(req.user.id, community_id, template.xp_reward, instance.id, 'quest', template.name);

  res.json({ xp_earned: template.xp_reward, message: `Quest complete! +${template.xp_reward} XP` });
});

// POST /api/quests/referral - process referral
router.post('/referral', authenticate, async (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code) return res.status(400).json({ error: 'invite_code required' });

  const { data: invite } = await supabase
    .from('telegram_invites')
    .select('*, communities(id)')
    .eq('invite_code', invite_code)
    .eq('status', 'pending')
    .single();

  if (!invite) return res.status(404).json({ error: 'Invalid or expired invite code' });
  if (invite.inviter_id === req.user.id) return res.status(400).json({ error: 'Cannot use your own invite' });

  // Mark invite as used
  await supabase.from('telegram_invites').update({
    invitee_id: req.user.id,
    status: 'used',
    used_at: new Date().toISOString()
  }).eq('id', invite.id);

  const communityId = invite.communities.id;

  // Award XP to inviter
  if (!invite.xp_awarded) {
    await awardXP(invite.inviter_id, communityId, 50, invite.id, 'referral', `Referral: new member joined`);
    await supabase.from('telegram_invites').update({ xp_awarded: true }).eq('id', invite.id);
  }

  // Award XP to invitee
  await awardXP(req.user.id, communityId, 25, invite.id, 'referral', 'Joined via referral link');

  res.json({ message: 'Referral processed! +25 XP for you, +50 XP for your referrer' });
});

// POST /api/quests/generate-referral
router.post('/generate-referral', authenticate, async (req, res) => {
  const { community_id } = req.body;
  if (!community_id) return res.status(400).json({ error: 'community_id required' });

  const { v4: uuidv4 } = require('uuid');
  const invite_code = `utopia_${req.user.id.slice(0, 6)}_${uuidv4().slice(0, 8)}`;

  const { data, error } = await supabase
    .from('telegram_invites')
    .insert({ inviter_id: req.user.id, community_id, invite_code })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invite_code: data.invite_code, link: `https://t.me/utopia_bot?start=${data.invite_code}` });
});

module.exports = router;
