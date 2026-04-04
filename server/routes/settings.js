'use strict'
const express = require('express')
const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// ── Site images directory ──────────────────────────────────────────────────────
const siteImagesDir = process.env.SITE_IMAGES_PATH
  ? path.resolve(process.env.SITE_IMAGES_PATH)
  : path.join(__dirname, '../../site-images')

if (!fs.existsSync(siteImagesDir)) fs.mkdirSync(siteImagesDir, { recursive: true })

// Valid image slot keys and their display labels
const SITE_IMAGE_KEYS = {
  hero_bg:          'Hero Background',
  home_carousel_1:  'Home – Carousel Image 1',
  home_carousel_2:  'Home – Carousel Image 2',
  home_assistants:  'Home – The Assistants',
  home_guarantee:   'Home – The Homebake Guarantee',
}

// Multer — uses req.params.key as the base filename so each slot has a unique file
const siteImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, siteImagesDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${req.params.key}${ext}`)
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp']
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true)
    else cb(new Error('Only JPG, PNG, or WebP images are allowed'))
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function currentImageUrl(key) {
  try {
    const files = fs.readdirSync(siteImagesDir).filter(f => path.parse(f).name === key)
    return files.length ? `/site-images/${files[0]}` : null
  } catch { return null }
}

// ── GET /api/settings — public settings + site image URLs ─────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_preferences').all()
  const settings = {}
  rows.forEach(r => { settings[r.key] = r.value })

  // Attach current site image URLs
  Object.keys(SITE_IMAGE_KEYS).forEach(key => {
    const url = currentImageUrl(key)
    if (url) settings[`img_${key}`] = url
  })

  res.json(settings)
})

// ── GET /api/settings/images — list of image slots with current URLs (admin) ──
router.get('/images', requireAuth, (req, res) => {
  const slots = Object.entries(SITE_IMAGE_KEYS).map(([key, label]) => ({
    key,
    label,
    currentUrl: currentImageUrl(key),
  }))
  res.json(slots)
})

// ── PUT /api/settings — update text/toggle settings (admin) ───────────────────
const ALLOWED_KEYS = [
  'announcement', 'announcement_active', 'shop_open', 'hero_tagline',
  // Contact
  'contact_email', 'contact_phone', 'contact_address',
  // Social
  'social_facebook', 'social_instagram', 'social_tiktok',
  // Business hours (one string per day, e.g. "9am – 5pm" or "Closed")
  'hours_mon', 'hours_tue', 'hours_wed', 'hours_thu', 'hours_fri', 'hours_sat', 'hours_sun',
  // SEO
  'seo_title', 'seo_description',
  // Order settings
  'order_notice_hours', 'order_max_qty',
]

router.put('/', requireAuth, (req, res) => {
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO app_preferences (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  )
  let updated = 0
  for (const [key, value] of Object.entries(req.body)) {
    if (ALLOWED_KEYS.includes(key)) {
      upsert.run(key, String(value))
      updated++
    }
  }
  res.json({ ok: true, updated })
})

// ── POST /api/settings/images/:key — upload a site image (admin) ──────────────
router.post('/images/:key', requireAuth, (req, res) => {
  if (!SITE_IMAGE_KEYS[req.params.key]) {
    return res.status(400).json({ error: 'Invalid image key' })
  }

  // Remove any existing file for this slot before saving the new one
  try {
    const existing = fs.readdirSync(siteImagesDir).filter(f => path.parse(f).name === req.params.key)
    existing.forEach(f => fs.unlinkSync(path.join(siteImagesDir, f)))
  } catch { /* no-op */ }

  siteImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No image provided' })
    res.json({ ok: true, url: `/site-images/${req.file.filename}` })
  })
})

// ── DELETE /api/settings/images/:key — revert to default image (admin) ────────
router.delete('/images/:key', requireAuth, (req, res) => {
  if (!SITE_IMAGE_KEYS[req.params.key]) {
    return res.status(400).json({ error: 'Invalid image key' })
  }
  try {
    const existing = fs.readdirSync(siteImagesDir).filter(f => path.parse(f).name === req.params.key)
    existing.forEach(f => fs.unlinkSync(path.join(siteImagesDir, f)))
  } catch { /* no-op */ }
  res.json({ ok: true })
})

module.exports = router
