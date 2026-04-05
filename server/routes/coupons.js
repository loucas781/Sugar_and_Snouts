'use strict'
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const db = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/coupons/validate?code=XXX — public
router.get('/validate', (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase()
  if (!code) return res.status(400).json({ error: 'Coupon code required' })

  const coupon = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1').get(code)
  if (!coupon) return res.status(404).json({ error: 'Invalid or inactive coupon code' })

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This coupon has expired' })
  }
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return res.status(400).json({ error: 'This coupon has reached its usage limit' })
  }

  res.json({ valid: true, code: coupon.code, type: coupon.type, value: coupon.value })
})

// GET /api/admin/coupons — list all (admin)
router.get('/admin', requireAuth, (req, res) => {
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all()
  res.json(coupons)
})

// POST /api/admin/coupons — create (admin)
router.post('/admin', requireAuth, (req, res) => {
  const { code, type, value, maxUses, expiresAt, isActive } = req.body
  if (!code || !type || value == null) {
    return res.status(400).json({ error: 'code, type and value are required' })
  }
  if (!['percentage', 'fixed'].includes(type)) {
    return res.status(400).json({ error: 'type must be percentage or fixed' })
  }
  if (type === 'percentage' && (value <= 0 || value > 100)) {
    return res.status(400).json({ error: 'Percentage must be between 1 and 100' })
  }
  if (type === 'fixed' && value <= 0) {
    return res.status(400).json({ error: 'Fixed discount must be greater than 0' })
  }

  const existing = db.prepare('SELECT id FROM coupons WHERE UPPER(code) = ?').get(code.trim().toUpperCase())
  if (existing) return res.status(400).json({ error: 'Coupon code already exists' })

  const id = uuidv4()
  db.prepare(`
    INSERT INTO coupons (id, code, type, value, max_uses, expires_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    code.trim().toUpperCase(),
    type,
    parseFloat(value),
    maxUses ? parseInt(maxUses) : null,
    expiresAt || null,
    isActive !== false ? 1 : 0
  )

  res.status(201).json(db.prepare('SELECT * FROM coupons WHERE id = ?').get(id))
})

// PATCH /api/admin/coupons/:id — update (admin)
router.patch('/admin/:id', requireAuth, (req, res) => {
  const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id)
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' })

  const { code, type, value, maxUses, expiresAt, isActive } = req.body

  if (code) {
    const existing = db.prepare('SELECT id FROM coupons WHERE UPPER(code) = ? AND id != ?').get(code.trim().toUpperCase(), req.params.id)
    if (existing) return res.status(400).json({ error: 'Coupon code already exists' })
  }

  db.prepare(`
    UPDATE coupons SET
      code       = COALESCE(?, code),
      type       = COALESCE(?, type),
      value      = COALESCE(?, value),
      max_uses   = ?,
      expires_at = ?,
      is_active  = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    code ? code.trim().toUpperCase() : null,
    type || null,
    value != null ? parseFloat(value) : null,
    maxUses !== undefined ? (maxUses ? parseInt(maxUses) : null) : coupon.max_uses,
    expiresAt !== undefined ? (expiresAt || null) : coupon.expires_at,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    req.params.id
  )

  res.json(db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id))
})

// DELETE /api/admin/coupons/:id — delete (admin)
router.delete('/admin/:id', requireAuth, (req, res) => {
  const coupon = db.prepare('SELECT id FROM coupons WHERE id = ?').get(req.params.id)
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' })
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
