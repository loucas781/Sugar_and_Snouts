'use strict'
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// POST /api/orders — submit order inquiry (public)
router.post('/', (req, res) => {
  const shopPref = db.prepare("SELECT value FROM app_preferences WHERE key = 'shop_open'").get()
  if (shopPref?.value === '0') {
    return res.status(503).json({ error: 'The shop is not currently accepting orders. Please check back soon.' })
  }

  const { customerName, customerEmail, customerPhone, items, notes } = req.body
  if (!customerName || !customerEmail || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Name, email and at least one item are required' })
  }

  // Validate each item against DB and check quantity limits
  let total = 0
  const validatedItems = []

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_available = 1').get(item.productId)
    if (!product) return res.status(400).json({ error: `Product not found: ${item.productId}` })

    const qty = parseInt(item.quantity)
    if (!qty || qty < 1) return res.status(400).json({ error: `Invalid quantity for ${product.name}` })

    if (product.quantity_limit && qty > product.quantity_limit) {
      return res.status(400).json({
        error: `${product.name} has a limit of ${product.quantity_limit} per order`
      })
    }

    // Use offer price if active
    const offerActive = product.offer_price && product.offer_expires_at
      ? new Date(product.offer_expires_at) > new Date()
      : product.offer_price && !product.offer_expires_at
    const unitPrice = offerActive ? product.offer_price : product.price

    total += unitPrice * qty
    validatedItems.push({
      productId:   product.id,
      productName: product.name,
      quantity:    qty,
      unitPrice,
      lineTotal:   unitPrice * qty
    })
  }

  const id = uuidv4()
  db.prepare(`
    INSERT INTO orders (id, customer_name, customer_email, customer_phone, items, total, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    customerName.trim(),
    customerEmail.toLowerCase().trim(),
    customerPhone?.trim() || null,
    JSON.stringify(validatedItems),
    Math.round(total * 100) / 100,
    notes?.trim() || null
  )

  res.status(201).json({ ok: true, orderId: id, total: Math.round(total * 100) / 100 })
})

// GET /api/admin/orders — list orders (admin)
router.get('/admin', requireAuth, (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query
  let sql = 'SELECT * FROM orders'
  const params = []
  if (status) { sql += ' WHERE status = ?'; params.push(status) }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const orders = db.prepare(sql).all(...params).map(o => ({
    ...o,
    items: JSON.parse(o.items)
  }))

  const total = db.prepare(status ? 'SELECT COUNT(*) as c FROM orders WHERE status = ?' : 'SELECT COUNT(*) as c FROM orders')
    .get(...(status ? [status] : []))
  res.json({ orders, total: total.c })
})

// GET /api/admin/orders/:id — single order (admin)
router.get('/admin/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  res.json({ ...order, items: JSON.parse(order.items) })
})

// PATCH /api/admin/orders/:id — update order status / admin notes
router.patch('/admin/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })

  const { status, adminNotes } = req.body
  const validStatuses = ['pending','confirmed','ready','collected','cancelled']
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  db.prepare(`
    UPDATE orders SET
      status = COALESCE(?, status),
      admin_notes = COALESCE(?, admin_notes),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(status || null, adminNotes !== undefined ? adminNotes : null, req.params.id)

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  res.json({ ...updated, items: JSON.parse(updated.items) })
})

module.exports = router
