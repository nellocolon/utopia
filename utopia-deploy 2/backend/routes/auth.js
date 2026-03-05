const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const supabase = require('../supabase');
const { authenticate } = require('../middleware/auth');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email, username, password } = value;
  const password_hash = await bcrypt.hash(password, 12);

  const { data, error: dbErr } = await supabase
    .from('users')
    .insert({ email, username, password_hash })
    .select('id, email, username, role, total_xp, created_at')
    .single();

  if (dbErr) {
    if (dbErr.code === '23505') {
      return res.status(409).json({ error: 'Email or username already taken' });
    }
    return res.status(500).json({ error: 'Registration failed' });
  }

  const token = jwt.sign(
    { id: data.id, email: data.email, username: data.username, role: data.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token, user: data });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email, password } = value;
  const { data: user, error: dbErr } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (dbErr || !user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const { password_hash, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, username, telegram_id, twitter_handle, avatar_url, role, total_xp, created_at')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

module.exports = router;
