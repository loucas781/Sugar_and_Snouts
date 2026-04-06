'use strict'
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')
const rateLimit = require('express-rate-limit')

const router = express.Router()

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many review submissions — please try again later.' },
})

// Admin routes MUST come before /:productId to avoid being swallowed by the param route

// GET /api/reviews/admin/all — all reviews with product info (admin)
router.get('/admin/all', requireAuth, (req, res) => {
  const { approved } = req.query
  let sql = `
    SELECT r.*, p.name as product_name
    FROM product_reviews r
    JOIN products p ON p.id = r.product_id`
  const params = []
  if (approved !== undefined) {
    sql += ' WHERE r.is_approved = ?'
    params.push(approved === '1' ? 1 : 0)
  }
  sql += ' ORDER BY r.created_at DESC'
  res.json(db.prepare(sql).all(...params))
})

// PATCH /api/reviews/admin/:id — approve or reject a review
router.patch('/admin/:id', requireAuth, (req, res) => {
  const { isApproved } = req.body
  if (isApproved === undefined) return res.status(400).json({ error: 'isApproved required' })
  const result = db.prepare('UPDATE product_reviews SET is_approved = ? WHERE id = ?')
    .run(isApproved ? 1 : 0, req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Review not found' })
  res.json({ ok: true })
})

// DELETE /api/reviews/admin/:id — delete a review
router.delete('/admin/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM product_reviews WHERE id = ?').run(req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Review not found' })
  res.json({ ok: true })
})

// GET /api/reviews/:productId — approved reviews for a product (public)
router.get('/:productId', (req, res) => {
  const reviews = db.prepare(
    'SELECT id, customer_name, rating, comment, created_at FROM product_reviews WHERE product_id = ? AND is_approved = 1 ORDER BY created_at DESC'
  ).all(req.params.productId)
  const avgRating = reviews.length
    ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 10) / 10
    : null
  res.json({ reviews, avgRating, count: reviews.length })
})

// POST /api/reviews/:productId — submit a review (public, rate-limited)
router.post('/:productId', reviewLimiter, (req, res) => {
  const reviewsEnabled = db.prepare("SELECT value FROM app_preferences WHERE key = 'reviews_enabled'").get()?.value
  if (reviewsEnabled === '0') return res.status(503).json({ error: 'Reviews are currently disabled' })

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_available = 1').get(req.params.productId)
  if (!product) return res.status(404).json({ error: 'Product not found' })

  const { customerName, customerEmail, rating, comment } = req.body
  if (!customerName?.trim()) return res.status(400).json({ error: 'Name is required' })
  if (!customerEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return res.status(400).json({ error: 'A valid email is required' })
  }
  const r = parseInt(rating)
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be 1–5' })

  db.prepare(
    'INSERT INTO product_reviews (id, product_id, customer_name, customer_email, rating, comment) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), req.params.productId, customerName.trim(), customerEmail.toLowerCase().trim(), r, comment?.trim() || null)

  res.status(201).json({ ok: true, message: 'Thank you! Your review is pending approval.' })
})

module.exports = router
