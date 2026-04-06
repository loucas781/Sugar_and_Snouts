'use strict'
const express = require('express')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

function getPref(key) {
  return db.prepare('SELECT value FROM app_preferences WHERE key = ?').get(key)?.value || ''
}

function getPayPalBase() {
  return getPref('paypal_mode') === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

async function getAccessToken() {
  const clientId     = getPref('paypal_client_id')
  const clientSecret = getPref('paypal_client_secret')
  if (!clientId || !clientSecret) throw new Error('PayPal not configured')

  const base = getPayPalBase()
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method:  'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error('PayPal auth failed')
  const data = await res.json()
  return data.access_token
}

// POST /api/paypal/create-order — create a PayPal order with the given amount
router.post('/create-order', async (req, res) => {
  if (getPref('paypal_enabled') !== '1') return res.status(400).json({ error: 'PayPal payments are not enabled' })

  const { amount } = req.body
  if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'Invalid amount' })

  try {
    const token = await getAccessToken()
    const base  = getPayPalBase()
    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'GBP', value: parseFloat(amount).toFixed(2) },
          description: getPref('site_name') || 'Sugar & Snouts Order',
        }],
      }),
    })
    if (!orderRes.ok) {
      const err = await orderRes.json()
      throw new Error(err.message || 'PayPal order creation failed')
    }
    const order = await orderRes.json()
    res.json({ orderId: order.id })
  } catch (err) {
    console.error('PayPal create-order error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/paypal/capture-order — capture a PayPal order after customer approves
router.post('/capture-order', async (req, res) => {
  if (getPref('paypal_enabled') !== '1') return res.status(400).json({ error: 'PayPal payments are not enabled' })

  const { paypalOrderId } = req.body
  if (!paypalOrderId) return res.status(400).json({ error: 'PayPal order ID required' })

  try {
    const token = await getAccessToken()
    const base  = getPayPalBase()
    const captureRes = await fetch(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!captureRes.ok) {
      const err = await captureRes.json()
      throw new Error(err.message || 'PayPal capture failed')
    }
    const capture = await captureRes.json()
    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id
    res.json({ captureId, status: capture.status })
  } catch (err) {
    console.error('PayPal capture-order error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/paypal/config — public config (client ID only, for SDK loading)
router.get('/config', (req, res) => {
  const enabled  = getPref('paypal_enabled') === '1'
  const clientId = getPref('paypal_client_id')
  res.json({ enabled, clientId: enabled ? clientId : null })
})

module.exports = router
