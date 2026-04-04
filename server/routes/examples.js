'use strict'
const express = require('express')
const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')
const { v4: uuidv4 } = require('uuid')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')
const { compressImage } = require('../utils/compressImage')

const router = express.Router()

const siteImagesDir = process.env.SITE_IMAGES_PATH
  ? path.resolve(process.env.SITE_IMAGES_PATH)
  : path.join(__dirname, '../../site-images')

if (!fs.existsSync(siteImagesDir)) fs.mkdirSync(siteImagesDir, { recursive: true })

const exampleImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, siteImagesDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `example_${req.params.id}${ext}`)
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — sharp compresses after upload
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp']
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true)
    else cb(new Error('Only JPG, PNG, or WebP images are allowed'))
  }
})

function exampleImageUrl(imagePath) {
  if (!imagePath) return null
  const file = path.join(siteImagesDir, imagePath)
  return fs.existsSync(file) ? `/site-images/${imagePath}` : null
}

function serializeExample(e) {
  return {
    id:        e.id,
    title:     e.title,
    sortOrder: e.sort_order,
    imageUrl:  exampleImageUrl(e.image_path),
    createdAt: e.created_at,
  }
}

// GET /api/home-examples — public
router.get('/', (req, res) => {
  const examples = db.prepare('SELECT * FROM home_examples ORDER BY sort_order ASC, created_at ASC').all()
  res.json(examples.map(serializeExample))
})

// POST /api/home-examples — create (admin)
router.post('/', requireAuth, (req, res) => {
  const { title, sortOrder } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
  const id = uuidv4()
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM home_examples').get()
  db.prepare('INSERT INTO home_examples (id, title, sort_order) VALUES (?, ?, ?)').run(
    id, title.trim(), sortOrder !== undefined ? parseInt(sortOrder) : (maxOrder.m || 0) + 1
  )
  const example = db.prepare('SELECT * FROM home_examples WHERE id = ?').get(id)
  res.status(201).json(serializeExample(example))
})

// PUT /api/home-examples/:id — update title / sort order (admin)
router.put('/:id', requireAuth, (req, res) => {
  const example = db.prepare('SELECT * FROM home_examples WHERE id = ?').get(req.params.id)
  if (!example) return res.status(404).json({ error: 'Not found' })
  const { title, sortOrder } = req.body
  db.prepare(`
    UPDATE home_examples SET
      title      = COALESCE(?, title),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(title?.trim() || null, sortOrder !== undefined ? parseInt(sortOrder) : null, req.params.id)
  const updated = db.prepare('SELECT * FROM home_examples WHERE id = ?').get(req.params.id)
  res.json(serializeExample(updated))
})

// POST /api/home-examples/:id/image — upload image (admin)
router.post('/:id/image', requireAuth, (req, res) => {
  const example = db.prepare('SELECT * FROM home_examples WHERE id = ?').get(req.params.id)
  if (!example) return res.status(404).json({ error: 'Not found' })

  // Remove any existing image file for this example
  try {
    const baseName = `example_${req.params.id}`
    const existing = fs.readdirSync(siteImagesDir).filter(f => path.parse(f).name === baseName)
    existing.forEach(f => fs.unlinkSync(path.join(siteImagesDir, f)))
  } catch { /* no-op */ }

  exampleImageUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No image provided' })

    let filename = req.file.filename
    try {
      const compressed = await compressImage(req.file.path)
      filename = path.basename(compressed)
    } catch (e) {
      console.error('Image compression failed:', e.message)
    }

    db.prepare('UPDATE home_examples SET image_path = ? WHERE id = ?').run(filename, req.params.id)
    res.json({ ok: true, imageUrl: `/site-images/${filename}` })
  })
})

// DELETE /api/home-examples/:id/image — remove image (admin)
router.delete('/:id/image', requireAuth, (req, res) => {
  const example = db.prepare('SELECT * FROM home_examples WHERE id = ?').get(req.params.id)
  if (!example) return res.status(404).json({ error: 'Not found' })
  try {
    if (example.image_path) {
      const file = path.join(siteImagesDir, example.image_path)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  } catch { /* no-op */ }
  db.prepare('UPDATE home_examples SET image_path = NULL WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// DELETE /api/home-examples/:id — delete example (admin)
router.delete('/:id', requireAuth, (req, res) => {
  const example = db.prepare('SELECT * FROM home_examples WHERE id = ?').get(req.params.id)
  if (!example) return res.status(404).json({ error: 'Not found' })
  try {
    if (example.image_path) {
      const file = path.join(siteImagesDir, example.image_path)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  } catch { /* no-op */ }
  db.prepare('DELETE FROM home_examples WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
