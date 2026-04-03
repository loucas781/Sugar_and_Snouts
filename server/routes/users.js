'use strict'
const express  = require('express')
const db       = require('../db/connection')
const { requireAdmin } = require('../middleware/auth')
const { hashPassword, validatePassword, getPasswordPolicy } = require('../auth-utils')
const audit    = require('../audit')

const router = express.Router()

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
}

// GET /api/admin/users
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role, is_active, created_at FROM admin_users ORDER BY created_at ASC'
  ).all()
  res.json(users)
})

// POST /api/admin/users  — create a new admin user
router.post('/', requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' })

  const allowedRoles = ['admin', 'editor']
  const userRole = allowedRoles.includes(role) ? role : 'editor'

  const policy = getPasswordPolicy()
  const validation = validatePassword(password, policy)
  if (!validation.ok) return res.status(400).json({ error: validation.errors[0], errors: validation.errors })

  const existing = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(email.toLowerCase().trim())
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' })

  const { v4: uuidv4 } = require('uuid')
  const hash = await hashPassword(password)
  const id = uuidv4()
  db.prepare(`
    INSERT INTO admin_users (id, name, email, password, role, is_active, token_version)
    VALUES (?, ?, ?, ?, ?, 1, 0)
  `).run(id, name.trim(), email.toLowerCase().trim(), hash, userRole)

  audit(req.user.id, 'admin.user_created', 'admin_user', id, email.toLowerCase().trim(), { role: userRole, ip: getIp(req) })
  res.status(201).json({ ok: true, id })
})

// PATCH /api/admin/users/:id  — update name, email, role, is_active
router.patch('/:id', requireAdmin, (req, res) => {
  const { id } = req.params
  const target = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ error: 'User not found' })

  const { name, email, role, is_active } = req.body
  const allowedRoles = ['admin', 'editor']

  // Guard: can't deactivate or demote the last active admin
  if ((is_active === 0 || is_active === false || role === 'editor') && target.role === 'admin') {
    const activeAdmins = db.prepare(
      "SELECT COUNT(*) as c FROM admin_users WHERE role = 'admin' AND is_active = 1 AND id != ?"
    ).get(id)
    if (activeAdmins.c === 0) {
      return res.status(409).json({ error: 'Cannot deactivate or demote the last active admin' })
    }
  }

  const updates = []
  const params  = []

  if (name  !== undefined) { updates.push('name = ?');      params.push(name.trim()) }
  if (email !== undefined) {
    const existing = db.prepare('SELECT id FROM admin_users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), id)
    if (existing) return res.status(409).json({ error: 'Email already in use' })
    updates.push('email = ?'); params.push(email.toLowerCase().trim())
  }
  if (role  !== undefined && allowedRoles.includes(role)) { updates.push('role = ?');  params.push(role) }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0) }

  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' })

  params.push(id)
  db.prepare(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  audit(req.user.id, 'admin.user_updated', 'admin_user', id, target.email, { changes: req.body, ip: getIp(req) })
  res.json({ ok: true })
})

// PATCH /api/admin/users/:id/password  — admin resets a user's password
router.patch('/:id/password', requireAdmin, async (req, res) => {
  const { id } = req.params
  const target = db.prepare('SELECT id, email FROM admin_users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ error: 'User not found' })

  const { password } = req.body
  if (!password) return res.status(400).json({ error: 'New password is required' })

  const policy = getPasswordPolicy()
  const validation = validatePassword(password, policy)
  if (!validation.ok) return res.status(400).json({ error: validation.errors[0], errors: validation.errors })

  const hash = await hashPassword(password)
  // Bump token_version to revoke all existing sessions for this user
  db.prepare('UPDATE admin_users SET password = ?, token_version = token_version + 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, id)

  audit(req.user.id, 'admin.user_password_reset', 'admin_user', id, target.email, { ip: getIp(req) })
  res.json({ ok: true })
})

// DELETE /api/admin/users/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const { id } = req.params
  if (id === req.user.id) return res.status(409).json({ error: 'You cannot delete your own account' })

  const target = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ error: 'User not found' })

  if (target.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE role = 'admin'").get()
    if (adminCount.c <= 1) return res.status(409).json({ error: 'Cannot delete the last admin account' })
  }

  db.prepare('DELETE FROM admin_users WHERE id = ?').run(id)
  audit(req.user.id, 'admin.user_deleted', 'admin_user', id, target.email, { ip: getIp(req) })
  res.json({ ok: true })
})

module.exports = router
