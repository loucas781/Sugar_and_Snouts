'use strict'
const express = require('express')
const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')
const { v4: uuidv4 } = require('uuid')
const db      = require('../db/connection')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// ── Multer setup ──────────────────────────────────────────────────────────────
const uploadDir = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(__dirname, '../../uploads')

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${uuidv4()}${ext}`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  }
})

// ── Category helpers ──────────────────────────────────────────────────────────
function getCategoryName(categoryId) {
  if (!categoryId) return null
  const cat = db.prepare('SELECT name FROM product_categories WHERE id = ?').get(categoryId)
  return cat ? cat.name : categoryId
}

// ── Helper: serialize product for API response ────────────────────────────────
function serializeProduct(p) {
  const offerActive = p.offer_price && p.offer_expires_at
    ? new Date(p.offer_expires_at) > new Date()
    : p.offer_price && !p.offer_expires_at

  return {
    id:            p.id,
    name:          p.name,
    description:   p.description,
    category:      p.category_id || p.category,
    categoryName:  getCategoryName(p.category_id) || p.category,
    price:         p.price,
    offerPrice:    offerActive ? p.offer_price : null,
    offerExpiresAt: p.offer_expires_at,
    imagePath:     p.image_path ? `/uploads/${path.basename(p.image_path)}` : null,
    isAvailable:   Boolean(p.is_available),
    isFeatured:    Boolean(p.is_featured),
    isRecommended: Boolean(p.is_recommended),
    isNew:         Boolean(p.is_new),
    quantityLimit: p.quantity_limit,
    sortOrder:     p.sort_order,
    createdAt:     p.created_at,
    updatedAt:     p.updated_at,
  }
}

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/products/categories — public list of categories (must be before /:id)
router.get('/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM product_categories ORDER BY sort_order ASC, name ASC').all()
  res.json(cats)
})

// GET /api/products — public product listing
router.get('/', (req, res) => {
  const { category, featured, recommended, new: isNew, limit } = req.query
  let sql = 'SELECT * FROM products WHERE is_available = 1'
  const params = []

  if (category) { sql += ' AND (category_id = ? OR (category_id IS NULL AND category = ?))'; params.push(category, category) }
  if (featured  === '1') { sql += ' AND is_featured = 1' }
  if (recommended === '1') { sql += ' AND is_recommended = 1' }
  if (isNew === '1') { sql += ' AND is_new = 1' }

  sql += ' ORDER BY sort_order ASC, created_at DESC'

  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)) }

  const products = db.prepare(sql).all(...params)
  res.json(products.map(serializeProduct))
})

// GET /api/products/:id — single product (public)
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_available = 1').get(req.params.id)
  if (!product) return res.status(404).json({ error: 'Product not found' })
  res.json(serializeProduct(product))
})

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/admin/products — all products (admin)
router.get('/admin/all', requireAuth, (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY sort_order ASC, created_at DESC').all()
  res.json(products.map(serializeProduct))
})

// POST /api/admin/products — create product
router.post('/admin', requireAuth, upload.single('image'), (req, res) => {
  const {
    name, description, categoryId, price, offerPrice, offerExpiresAt,
    isAvailable, isFeatured, isRecommended, isNew, quantityLimit, sortOrder
  } = req.body

  if (!name || !price) return res.status(400).json({ error: 'Name and price are required' })
  if (!categoryId) return res.status(400).json({ error: 'Category is required' })

  const id = uuidv4()
  const imagePath = req.file ? req.file.filename : null

  db.prepare(`
    INSERT INTO products (id, name, description, category, category_id, price, offer_price, offer_expires_at,
      image_path, is_available, is_featured, is_recommended, is_new, quantity_limit, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name.trim(), description?.trim() || null,
    'other', categoryId,
    parseFloat(price),
    offerPrice ? parseFloat(offerPrice) : null,
    offerExpiresAt || null,
    imagePath,
    isAvailable === 'false' ? 0 : 1,
    isFeatured    === 'true' ? 1 : 0,
    isRecommended === 'true' ? 1 : 0,
    isNew         === 'true' ? 1 : 0,
    quantityLimit ? parseInt(quantityLimit) : null,
    sortOrder ? parseInt(sortOrder) : 0
  )

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id)
  res.status(201).json(serializeProduct(product))
})

// PUT /api/admin/products/:id — update product (no image)
router.put('/admin/:id', requireAuth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  if (!product) return res.status(404).json({ error: 'Product not found' })

  const {
    name, description, categoryId, price, offerPrice, offerExpiresAt,
    isAvailable, isFeatured, isRecommended, isNew, quantityLimit, sortOrder
  } = req.body

  db.prepare(`
    UPDATE products SET
      name = ?, description = ?, category_id = ?, price = ?,
      offer_price = ?, offer_expires_at = ?,
      is_available = ?, is_featured = ?, is_recommended = ?, is_new = ?,
      quantity_limit = ?, sort_order = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name?.trim() || product.name,
    description?.trim() ?? product.description,
    categoryId || product.category_id || product.category,
    price !== undefined ? parseFloat(price) : product.price,
    offerPrice !== undefined ? (offerPrice ? parseFloat(offerPrice) : null) : product.offer_price,
    offerExpiresAt !== undefined ? (offerExpiresAt || null) : product.offer_expires_at,
    isAvailable !== undefined ? (isAvailable ? 1 : 0) : product.is_available,
    isFeatured  !== undefined ? (isFeatured  ? 1 : 0) : product.is_featured,
    isRecommended !== undefined ? (isRecommended ? 1 : 0) : product.is_recommended,
    isNew !== undefined ? (isNew ? 1 : 0) : product.is_new,
    quantityLimit !== undefined ? (quantityLimit ? parseInt(quantityLimit) : null) : product.quantity_limit,
    sortOrder !== undefined ? parseInt(sortOrder) : product.sort_order,
    req.params.id
  )

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  res.json(serializeProduct(updated))
})

// POST /api/admin/products/:id/image — upload/replace product image
router.post('/admin/:id/image', requireAuth, upload.single('image'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  if (!product) return res.status(404).json({ error: 'Product not found' })
  if (!req.file) return res.status(400).json({ error: 'No image file provided' })

  // Delete old image if it exists
  if (product.image_path) {
    const oldPath = path.join(uploadDir, product.image_path)
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
  }

  db.prepare("UPDATE products SET image_path = ?, updated_at = datetime('now') WHERE id = ?")
    .run(req.file.filename, req.params.id)

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  res.json(serializeProduct(updated))
})

// DELETE /api/admin/products/:id — delete product
router.delete('/admin/:id', requireAuth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)
  if (!product) return res.status(404).json({ error: 'Product not found' })

  // Delete image file
  if (product.image_path) {
    const imgPath = path.join(uploadDir, product.image_path)
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath)
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Product Categories ────────────────────────────────────────────────────────

// POST /api/admin/categories — create category (admin)
router.post('/admin/categories', requireAuth, (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' })

  const { v4: uuidv4 } = require('uuid')
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const existing = db.prepare('SELECT id FROM product_categories WHERE id = ? OR name = ?').get(id, name.trim())
  if (existing) return res.status(409).json({ error: 'A category with this name already exists' })

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM product_categories').get()
  db.prepare('INSERT INTO product_categories (id, name, sort_order) VALUES (?, ?, ?)').run(id, name.trim(), (maxOrder.m || 0) + 1)
  res.status(201).json({ ok: true, id, name: name.trim() })
})

// DELETE /api/admin/categories/:id — delete category (admin)
router.delete('/admin/categories/:id', requireAuth, (req, res) => {
  const { id } = req.params
  const inUse = db.prepare('SELECT COUNT(*) as c FROM products WHERE category_id = ?').get(id)
  if (inUse.c > 0) return res.status(409).json({ error: `Cannot delete — ${inUse.c} product(s) use this category` })
  db.prepare('DELETE FROM product_categories WHERE id = ?').run(id)
  res.json({ ok: true })
})

// ── Multer error handler ──────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image too large — max 8 MB' })
  if (err) return res.status(400).json({ error: err.message || 'Upload failed' })
  next()
})

module.exports = router
