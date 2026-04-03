'use strict'
const express    = require('express')
const nodemailer = require('nodemailer')
const { v4: uuidv4 } = require('uuid')
const db         = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

function getTransport() {
  const host = process.env.SMTP_HOST
  if (!host) return null
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
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
    const to = process.env.CONTACT_EMAIL || 'SugarandSnouts02@gmail.com'
    transport.sendMail({
      from:    process.env.SMTP_FROM || `Sugar & Snouts <noreply@sugarandsnouts.co.uk>`,
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

module.exports = router
