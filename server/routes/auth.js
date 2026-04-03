'use strict'
const express  = require('express')
const jwt      = require('jsonwebtoken')
const db       = require('../db/connection')
const { requireAuth, cookieOpts } = require('../middleware/auth')
const { hashPassword, comparePassword, validatePassword, getPasswordPolicy } = require('../auth-utils')
const audit    = require('../audit')

const router = express.Router()

const LOCKOUT_ATTEMPTS = parseInt(process.env.LOGIN_LOCKOUT_ATTEMPTS || 5)
const LOCKOUT_MINUTES  = parseInt(process.env.LOGIN_LOCKOUT_MINUTES  || 15)

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
}

// GET /api/auth/setup-status  — public, tells the UI whether first-run setup is needed
router.get('/setup-status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM admin_users').get()
  res.json({ setupRequired: count.c === 0 })
})

// POST /api/auth/setup  — create the first admin; fails if any user already exists
router.post('/setup', async (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM admin_users').get()
  if (count.c > 0) return res.status(403).json({ error: 'Setup already complete' })

  const { name, email, password } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' })

  const policy = getPasswordPolicy()
  const validation = validatePassword(password, policy)
  if (!validation.ok) return res.status(400).json({ error: validation.errors[0], errors: validation.errors })

  const { v4: uuidv4 } = require('uuid')
  const hash = await hashPassword(password)
  db.prepare(`
    INSERT INTO admin_users (id, name, email, password, role, is_active, token_version)
    VALUES (?, ?, ?, ?, 'admin', 1, 0)
  `).run(uuidv4(), name.trim(), email.toLowerCase().trim(), hash)

  audit(null, 'admin.setup', null, null, email.toLowerCase().trim(), { ip: getIp(req) })
  res.json({ ok: true })
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email.toLowerCase().trim())

  // User not found — still do a dummy compare to prevent timing attacks
  if (!user) {
    await comparePassword(password, '$2a$12$invaliddummyhashfortimingatacks0000000000000000000000000')
    audit(null, 'auth.failed_login', null, null, null, { email: email.toLowerCase().trim(), reason: 'user_not_found', ip: getIp(req) })
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  if (!user.is_active) {
    audit(null, 'auth.failed_login', null, user.id, user.email, { reason: 'account_deactivated', ip: getIp(req) })
    return res.status(403).json({ error: 'Account is deactivated' })
  }

  // Brute-force lockout check
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until)
    if (lockedUntil > new Date()) {
      const remaining = Math.ceil((lockedUntil - new Date()) / 60000)
      audit(user.id, 'auth.failed_login', null, user.id, user.email, { reason: 'account_locked', ip: getIp(req) })
      return res.status(429).json({ error: `Account locked. Try again in ${remaining} minute${remaining === 1 ? '' : 's'}.` })
    }
    // Lockout expired — reset
    db.prepare('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id)
  }

  const { ok, needsRehash } = await comparePassword(password, user.password)

  if (!ok) {
    const attempts = (user.failed_attempts || 0) + 1
    if (attempts >= LOCKOUT_ATTEMPTS) {
      const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      db.prepare('UPDATE admin_users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, until, user.id)
      audit(user.id, 'auth.failed_login', null, user.id, user.email, { reason: 'invalid_password', attempts, locked_until: until, ip: getIp(req) })
      return res.status(429).json({ error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` })
    }
    db.prepare('UPDATE admin_users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id)
    audit(user.id, 'auth.failed_login', null, user.id, user.email, { reason: 'invalid_password', attempts, ip: getIp(req) })
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  // Successful login — reset failed attempts
  db.prepare('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id)

  // Transparent pepper re-hash if using old pepper
  if (needsRehash) {
    const newHash = await hashPassword(password)
    db.prepare('UPDATE admin_users SET password = ? WHERE id = ?').run(newHash, user.id)
  }

  const maxAge = parseInt(process.env.COOKIE_MAX_AGE_HOURS || 72) * 3600
  const token = jwt.sign(
    { id: user.id, role: user.role, tv: user.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: maxAge }
  )

  const opts = { ...cookieOpts(), maxAge: maxAge * 1000 }
  res.cookie('token', token, opts)

  audit(user.id, 'admin.login', null, user.id, user.email, { ip: getIp(req) })
  res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } })
})

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  res.clearCookie('token', cookieOpts())
  audit(req.user.id, 'admin.logout', null, req.user.id, req.user.email, { ip: getIp(req) })
  res.json({ ok: true })
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// PATCH /api/auth/password  — change own password
router.patch('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords are required' })

  const policy = getPasswordPolicy()
  const validation = validatePassword(newPassword, policy)
  if (!validation.ok) return res.status(400).json({ error: validation.errors[0], errors: validation.errors })

  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.user.id)
  const { ok } = await comparePassword(currentPassword, user.password)
  if (!ok) {
    audit(req.user.id, 'settings.password_change_failed', null, req.user.id, req.user.email, { reason: 'wrong_current_password', ip: getIp(req) })
    return res.status(401).json({ error: 'Current password is incorrect' })
  }

  const hash = await hashPassword(newPassword)
  // Bump token_version to invalidate all existing sessions
  db.prepare('UPDATE admin_users SET password = ?, token_version = token_version + 1 WHERE id = ?').run(hash, req.user.id)

  audit(req.user.id, 'settings.password_change', null, req.user.id, req.user.email, { ip: getIp(req) })

  // Issue fresh token with new token_version so this session stays valid
  const updatedUser = db.prepare('SELECT token_version FROM admin_users WHERE id = ?').get(req.user.id)
  const maxAge = parseInt(process.env.COOKIE_MAX_AGE_HOURS || 72) * 3600
  const token = jwt.sign(
    { id: req.user.id, role: req.user.role, tv: updatedUser.token_version },
    process.env.JWT_SECRET,
    { expiresIn: maxAge }
  )
  const opts = { ...cookieOpts(), maxAge: maxAge * 1000 }
  res.cookie('token', token, opts)

  res.json({ ok: true })
})

module.exports = router
