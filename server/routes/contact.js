'use strict'
const express    = require('express')
const nodemailer = require('nodemailer')
const { v4: uuidv4 } = require('uuid')
const db         = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

function getSetting(key) {
  try {
    return db.prepare("SELECT value FROM app_preferences WHERE key = ?").get(key)?.value || null
  } catch { return null }
}

function getTransport() {
  const host = getSetting('smtp_host') || process.env.SMTP_HOST
  if (!host) return null
  const port = parseInt(getSetting('smtp_port') || process.env.SMTP_PORT || 587)
  const user = getSetting('smtp_user') || process.env.SMTP_USER
  const pass = getSetting('smtp_pass') || process.env.SMTP_PASS
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined
  })
}

// POST /api/contact
router.post('/', (req, res) => {
  const { name, email, message, optin } = req.body
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  // Save to DB always
  db.prepare(`
    INSERT INTO contact_messages (id, name, email, message, optin)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), name.trim(), email.toLowerCase().trim(), message.trim(), optin ? 1 : 0)

  // Attempt email send if SMTP configured
  const transport = getTransport()
  if (transport) {
    const to = getSetting('order_notification_email') || getSetting('contact_email') || process.env.CONTACT_EMAIL || 'SugarandSnouts02@gmail.com'
    const fromName = getSetting('email_from_name') || 'Sugar & Snouts'
    transport.sendMail({
      from:    getSetting('smtp_from') || process.env.SMTP_FROM || `${fromName} <noreply@sugarandsnouts.co.uk>`,
      to,
      subject: `New message from ${name} — Sugar & Snouts`,
      text:    `Name: ${name}\nEmail: ${email}\nMessage:\n${message}\n\nMarketing opt-in: ${optin ? 'Yes' : 'No'}`
    }).catch(err => console.error('[contact] email failed:', err.message))
  }

  res.json({ ok: true })
})

// GET /api/admin/messages — list contact messages (admin)
router.get('/admin', requireAuth, (req, res) => {
  const msgs = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all()
  res.json(msgs)
})

// PATCH /api/admin/messages/:id/read
router.patch('/admin/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// POST /api/contact/admin/smtp-test — send a test email (admin)
router.post('/admin/smtp-test', requireAuth, async (req, res) => {
  const transport = getTransport()
  if (!transport) {
    return res.status(400).json({ error: 'No SMTP configuration found. Please save your SMTP settings first.' })
  }
  const to = getSetting('order_notification_email') || getSetting('contact_email') || process.env.CONTACT_EMAIL
  if (!to) {
    return res.status(400).json({ error: 'No recipient email configured. Set an Order Notification Email or Contact Email first.' })
  }
  try {
    const fromName = getSetting('email_from_name') || 'Sugar & Snouts'
    await transport.sendMail({
      from:    getSetting('smtp_from') || process.env.SMTP_FROM || `${fromName} <noreply@sugarandsnouts.co.uk>`,
      to,
      subject: 'Sugar & Snouts — SMTP test',
      text:    'This is a test email confirming your SMTP configuration is working correctly.'
    })
    res.json({ ok: true, message: `Test email sent to ${to}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/messages/:id
router.delete('/admin/:id', requireAuth, (req, res) => {
  const msg = db.prepare('SELECT id FROM contact_messages WHERE id = ?').get(req.params.id)
  if (!msg) return res.status(404).json({ error: 'Message not found' })
  db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
