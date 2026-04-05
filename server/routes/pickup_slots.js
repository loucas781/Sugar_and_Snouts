'use strict'
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const db = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/pickup-slots — public active slots
router.get('/', (req, res) => {
  const slots = db.prepare('SELECT id, label, sort_order FROM pickup_slots WHERE is_active = 1 ORDER BY sort_order ASC, label ASC').all()
  res.json(slots)
})

// GET /api/admin/pickup-slots — all slots (admin)
router.get('/admin', requireAuth, (req, res) => {
  const slots = db.prepare('SELECT * FROM pickup_slots ORDER BY sort_order ASC, label ASC').all()
  res.json(slots)
})

// POST /api/admin/pickup-slots — create (admin)
router.post('/admin', requireAuth, (req, res) => {
  const { label, isActive, sortOrder } = req.body
  if (!label || !label.trim()) return res.status(400).json({ error: 'Label is required' })

  const id = uuidv4()
  db.prepare('INSERT INTO pickup_slots (id, label, is_active, sort_order) VALUES (?, ?, ?, ?)')
    .run(id, label.trim(), isActive !== false ? 1 : 0, sortOrder ? parseInt(sortOrder) : 0)

  res.status(201).json(db.prepare('SELECT * FROM pickup_slots WHERE id = ?').get(id))
})

// PATCH /api/admin/pickup-slots/:id — update (admin)
router.patch('/admin/:id', requireAuth, (req, res) => {
  const slot = db.prepare('SELECT id FROM pickup_slots WHERE id = ?').get(req.params.id)
  if (!slot) return res.status(404).json({ error: 'Slot not found' })

  const { label, isActive, sortOrder } = req.body
  db.prepare(`
    UPDATE pickup_slots SET
      label      = COALESCE(?, label),
      is_active  = COALESCE(?, is_active),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    label ? label.trim() : null,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    sortOrder != null ? parseInt(sortOrder) : null,
    req.params.id
  )

  res.json(db.prepare('SELECT * FROM pickup_slots WHERE id = ?').get(req.params.id))
})

// DELETE /api/admin/pickup-slots/:id — delete (admin)
router.delete('/admin/:id', requireAuth, (req, res) => {
  const slot = db.prepare('SELECT id FROM pickup_slots WHERE id = ?').get(req.params.id)
  if (!slot) return res.status(404).json({ error: 'Slot not found' })
  db.prepare('DELETE FROM pickup_slots WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
