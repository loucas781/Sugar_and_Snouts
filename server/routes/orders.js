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
    const closedMsg = db.prepare("SELECT value FROM app_preferences WHERE key = 'shop_closed_message'").get()
    return res.status(503).json({ error: closedMsg?.value || 'The shop is not currently accepting orders. Please check back soon.' })
  }

  // Check daily order limit
  const dailyLimitPref = db.prepare("SELECT value FROM app_preferences WHERE key = 'order_daily_limit'").get()
  const dailyLimit = dailyLimitPref?.value ? parseInt(dailyLimitPref.value) : null
  if (dailyLimit) {
    const todayCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now') AND status != 'cancelled'").get()
    if (todayCount.c >= dailyLimit) {
      return res.status(503).json({ error: 'We have reached our maximum orders for today. Please try again tomorrow.' })
    }
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

    if (product.is_out_of_stock) {
      return res.status(400).json({ error: `${product.name} is currently out of stock` })
    }

    if (product.stock_amount != null && qty > product.stock_amount) {
      return res.status(400).json({
        error: product.stock_amount === 0
          ? `${product.name} is out of stock`
          : `Only ${product.stock_amount} of "${product.name}" available`
      })
    }

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

  // Check minimum order value
  const minOrderPref = db.prepare("SELECT value FROM app_preferences WHERE key = 'minimum_order_value'").get()
  const minOrderValue = minOrderPref?.value ? parseFloat(minOrderPref.value) : 0
  if (minOrderValue > 0 && total < minOrderValue) {
    return res.status(400).json({ error: `Minimum order value is £${minOrderValue.toFixed(2)}. Your order total is £${total.toFixed(2)}.` })
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

  // Deduct stock for products with stock tracking enabled
  for (const item of validatedItems) {
    const product = db.prepare('SELECT stock_amount FROM products WHERE id = ?').get(item.productId)
    if (product && product.stock_amount != null) {
      const newStock = Math.max(0, product.stock_amount - item.quantity)
      db.prepare("UPDATE products SET stock_amount = ?, is_out_of_stock = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newStock, newStock <= 0 ? 1 : 0, item.productId)
    }
  }

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

  // Restore stock when cancelling an order that wasn't already cancelled
  if (status === 'cancelled' && order.status !== 'cancelled') {
    const items = JSON.parse(order.items)
    for (const item of items) {
      const product = db.prepare('SELECT stock_amount, is_out_of_stock FROM products WHERE id = ?').get(item.productId)
      if (product && product.stock_amount != null) {
        const restored = product.stock_amount + item.quantity
        db.prepare("UPDATE products SET stock_amount = ?, is_out_of_stock = 0, updated_at = datetime('now') WHERE id = ?")
          .run(restored, item.productId)
      }
    }
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  res.json({ ...updated, items: JSON.parse(updated.items) })
})

module.exports = router
