'use strict'
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')
const { sendOrderConfirmation, sendStatusUpdate, sendNewOrderNotification } = require('../utils/email')

const router = express.Router()

// GET /api/orders/track — public order status lookup
router.get('/track', (req, res) => {
  const { id, email } = req.query
  if (!id || !email) return res.status(400).json({ error: 'Order ID and email are required' })

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id)
  if (!order || order.customer_email.toLowerCase() !== email.toLowerCase().trim()) {
    return res.status(404).json({ error: 'Order not found. Please check your order ID and email.' })
  }

  res.json({
    id:           order.id,
    status:       order.status,
    customerName: order.customer_name,
    items:        JSON.parse(order.items),
    total:        order.total,
    discountAmount: order.discount_amount || 0,
    couponCode:   order.coupon_code || null,
    pickupSlot:   order.pickup_slot || null,
    orderDate:    order.order_date  || null,
    notes:        order.notes || null,
    createdAt:    order.created_at,
    updatedAt:    order.updated_at,
  })
})

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

  const { customerName, customerEmail, customerPhone, items, notes, couponCode, pickupSlot, orderDate } = req.body
  if (!customerName || !customerEmail || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Name, email and at least one item are required' })
  }

  // Validate pre-order date
  if (orderDate) {
    const maxDaysAhead = parseInt(db.prepare("SELECT value FROM app_preferences WHERE key = 'order_max_days_ahead'").get()?.value || '0')
    const requested = new Date(orderDate)
    const today = new Date(); today.setHours(0,0,0,0)
    if (requested < today) {
      return res.status(400).json({ error: 'Order date cannot be in the past' })
    }
    if (maxDaysAhead > 0) {
      const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + maxDaysAhead)
      if (requested > maxDate) {
        return res.status(400).json({ error: `Orders can only be placed up to ${maxDaysAhead} days in advance` })
      }
    }
  }

  // Validate pickup slot
  if (pickupSlot) {
    const slotsEnabled = db.prepare("SELECT value FROM app_preferences WHERE key = 'pickup_slots_enabled'").get()?.value
    if (slotsEnabled === '1') {
      const slot = db.prepare('SELECT id FROM pickup_slots WHERE id = ? AND is_active = 1').get(pickupSlot)
      if (!slot) return res.status(400).json({ error: 'Invalid pickup slot selected' })
    }
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
    return res.status(400).json({ error: `Minimum order value is \u00a3${minOrderValue.toFixed(2)}. Your order total is \u00a3${total.toFixed(2)}.` })
  }

  // Validate and apply coupon
  let discountAmount = 0
  let appliedCouponCode = null
  if (couponCode) {
    const code = couponCode.trim().toUpperCase()
    const coupon = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1').get(code)
    if (!coupon) return res.status(400).json({ error: 'Invalid or inactive coupon code' })
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This coupon has expired' })
    }
    if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
      return res.status(400).json({ error: 'This coupon has reached its usage limit' })
    }

    discountAmount = coupon.type === 'percentage'
      ? Math.round(total * (coupon.value / 100) * 100) / 100
      : Math.min(coupon.value, total)

    appliedCouponCode = coupon.code
    db.prepare('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ?').run(coupon.id)
  }

  const finalTotal = Math.max(0, Math.round((total - discountAmount) * 100) / 100)

  const id = uuidv4()
  db.prepare(`
    INSERT INTO orders (id, customer_name, customer_email, customer_phone, items, total, notes, coupon_code, discount_amount, pickup_slot, order_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    customerName.trim(),
    customerEmail.toLowerCase().trim(),
    customerPhone?.trim() || null,
    JSON.stringify(validatedItems),
    finalTotal,
    notes?.trim() || null,
    appliedCouponCode,
    discountAmount,
    pickupSlot || null,
    orderDate || null
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

  const savedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(id)

  // Send emails (non-blocking)
  sendOrderConfirmation(savedOrder).catch(e => console.error('Confirmation email failed:', e.message))
  sendNewOrderNotification(savedOrder).catch(e => console.error('Notification email failed:', e.message))

  res.status(201).json({ ok: true, orderId: id, total: finalTotal, discountAmount })
})

// GET /api/orders/admin — list orders (admin)
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

// GET /api/orders/admin/:id — single order (admin)
router.get('/admin/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  if (!order) return res.status(404).json({ error: 'Order not found' })
  res.json({ ...order, items: JSON.parse(order.items) })
})

// PATCH /api/orders/admin/:id — update order status / admin notes
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

  // Send status update email to customer (non-blocking)
  if (status && status !== order.status) {
    sendStatusUpdate(updated, status).catch(e => console.error('Status email failed:', e.message))
  }

  res.json({ ...updated, items: JSON.parse(updated.items) })
})

module.exports = router
