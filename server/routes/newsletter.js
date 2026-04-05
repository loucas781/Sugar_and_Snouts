'use strict'
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const nodemailer = require('nodemailer')
const db = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

function getPref(key) {
  return db.prepare('SELECT value FROM app_preferences WHERE key = ?').get(key)?.value || ''
}

function getTransporter() {
  const host = getPref('smtp_host')
  const port = getPref('smtp_port')
  const user = getPref('smtp_user')
  const pass = getPref('smtp_pass')
  if (!host || !port) return null
  return nodemailer.createTransport({
    host,
    port: parseInt(port),
    secure: parseInt(port) === 465,
    auth: (user && pass) ? { user, pass } : undefined,
  })
}

const router = express.Router()

// POST /api/newsletter/subscribe — public
router.post('/subscribe', (req, res) => {
  const enabled = db.prepare("SELECT value FROM app_preferences WHERE key = 'newsletter_enabled'").get()
  if (enabled?.value !== '1') {
    return res.status(503).json({ error: 'Newsletter signup is not currently available' })
  }

  const email = (req.body.email || '').toLowerCase().trim()
  const name  = (req.body.name  || '').trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' })
  }

  const existing = db.prepare('SELECT id, is_active FROM newsletter_subscribers WHERE email = ?').get(email)
  if (existing) {
    if (existing.is_active) {
      return res.json({ ok: true, alreadySubscribed: true })
    }
    db.prepare("UPDATE newsletter_subscribers SET is_active = 1, name = COALESCE(?, name), optin_at = datetime('now') WHERE id = ?")
      .run(name || null, existing.id)
    return res.json({ ok: true })
  }

  db.prepare('INSERT INTO newsletter_subscribers (id, email, name) VALUES (?, ?, ?)')
    .run(uuidv4(), email, name || null)

  res.status(201).json({ ok: true })
})

// GET /api/admin/newsletter — list subscribers (admin)
router.get('/admin', requireAuth, (req, res) => {
  const subscribers = db.prepare('SELECT * FROM newsletter_subscribers ORDER BY optin_at DESC').all()
  res.json({ subscribers, total: subscribers.length })
})

// DELETE /api/admin/newsletter/:id — remove subscriber (admin)
router.delete('/admin/:id', requireAuth, (req, res) => {
  const sub = db.prepare('SELECT id FROM newsletter_subscribers WHERE id = ?').get(req.params.id)
  if (!sub) return res.status(404).json({ error: 'Subscriber not found' })
  db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// PATCH /api/admin/newsletter/:id/status — toggle active (admin)
router.patch('/admin/:id/status', requireAuth, (req, res) => {
  const sub = db.prepare('SELECT id, is_active FROM newsletter_subscribers WHERE id = ?').get(req.params.id)
  if (!sub) return res.status(404).json({ error: 'Subscriber not found' })
  const newStatus = sub.is_active ? 0 : 1
  db.prepare('UPDATE newsletter_subscribers SET is_active = ? WHERE id = ?').run(newStatus, req.params.id)
  res.json({ ok: true, is_active: newStatus })
})

// POST /api/newsletter/admin/send — send email to all active subscribers (admin)
router.post('/admin/send', requireAuth, async (req, res) => {
  const { subject, html, text } = req.body
  if (!subject || !html) return res.status(400).json({ error: 'Subject and html body are required' })

  const transporter = getTransporter()
  if (!transporter) return res.status(503).json({ error: 'Email (SMTP) is not configured. Check Settings → Contact.' })

  const fromName = getPref('email_from_name') || getPref('site_name') || 'Sugar & Snouts'
  const smtpFrom = getPref('smtp_from') || getPref('smtp_user')
  if (!smtpFrom) return res.status(503).json({ error: 'No sender address configured. Check Settings → Contact.' })
  const from = `"${fromName}" <${smtpFrom}>`

  const subscribers = db.prepare("SELECT email, name FROM newsletter_subscribers WHERE is_active = 1").all()
  if (!subscribers.length) return res.json({ ok: true, sent: 0 })

  let sent = 0
  const errors = []
  for (const sub of subscribers) {
    try {
      await transporter.sendMail({ from, to: sub.email, subject, html, text: text || undefined })
      sent++
    } catch (err) {
      errors.push(sub.email)
    }
  }

  res.json({ ok: true, sent, failed: errors.length })
})

module.exports = router
