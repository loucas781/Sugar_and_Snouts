'use strict'

// ─── Load environment ─────────────────────────────────────────────────────────
const fs   = require('fs')
const path = require('path')

const env     = process.env.NODE_ENV || 'development'
const envFile = path.join(__dirname, '../', `.env.${env}`)
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) return
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k && !process.env[k]) process.env[k] = v
  })
}

// ─── Version ──────────────────────────────────────────────────────────────────
const versionFile = path.join(__dirname, '../.version')
const rawVersion  = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : require('../package.json').version

const baseVersion = rawVersion.replace(/-dev\.\d+/, '').replace(/-rc.*/, '')
const APP_ENV     = (process.env.APP_ENV || env).toLowerCase()
let APP_VERSION
if (APP_ENV === 'production') {
  APP_VERSION = baseVersion
} else if (APP_ENV === 'staging') {
  APP_VERSION = rawVersion.includes('-rc') ? rawVersion : `${baseVersion}-rc`
} else {
  APP_VERSION = rawVersion.includes('-dev.') ? rawVersion : `${baseVersion}-dev.0`
}

// ─── Run migration on startup ─────────────────────────────────────────────────
require('./db/migrate')

// ─── App ──────────────────────────────────────────────────────────────────────
const express      = require('express')
const cookieParser = require('cookie-parser')
const rateLimit    = require('express-rate-limit')
const { optionalAuth } = require('./middleware/auth')

const app = express()

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: false, limit: '2mb' }))
app.use(cookieParser())

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1)

// ─── Security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('X-XSS-Protection', '1; mode=block')
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (APP_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

// ─── Rate limiters ────────────────────────────────────────────────────────────
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  skip: () => APP_ENV === 'development',
  message: { error: 'Too many login attempts — please wait 15 minutes.' },
}))
app.use('/api/orders', rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  skip: () => APP_ENV === 'development',
  message: { error: 'Too many order submissions — please try again later.' },
}))
app.use('/api/contact', rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  skip: () => APP_ENV === 'development',
  message: { error: 'Too many messages — please try again later.' },
}))

// ─── Maintenance mode ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  // Allow admin pages, API auth, health check, and static assets through unconditionally
  if (
    req.path.startsWith('/admin') ||
    req.path.startsWith('/api/auth') ||
    req.path === '/api/health' ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/img/') ||
    req.path === '/favicon.jpg'
  ) {
    return next()
  }
  try {
    const db = require('./db/connection')
    const pref = db.prepare("SELECT value FROM app_preferences WHERE key = 'maintenance_mode'").get()
    if (pref?.value === '1') {
      // Allow authenticated admins through on API routes so the dashboard keeps working
      if (req.path.startsWith('/api/')) {
        const token = req.cookies?.token
        if (token) {
          try {
            const jwt = require('jsonwebtoken')
            const payload = jwt.verify(token, process.env.JWT_SECRET)
            const user = db.prepare(
              'SELECT id, is_active, token_version FROM admin_users WHERE id = ?'
            ).get(payload.id)
            if (user && user.is_active && (user.token_version || 0) === (payload.tv || 0)) {
              return next()
            }
          } catch { /* invalid token — fall through to maintenance */ }
        }
      }

      const msgPref = db.prepare("SELECT value FROM app_preferences WHERE key = 'maintenance_message'").get()
      const message = msgPref?.value || "We'll be back soon!"
      if (req.path.startsWith('/api/')) {
        return res.status(503).json({ error: message })
      }
      return res.status(503).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance — Sugar &amp; Snouts</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#fdf6f0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.box{max-width:480px}.icon{font-size:4rem;margin-bottom:1rem}.title{font-size:1.8rem;font-weight:700;color:#1a1a1a;margin-bottom:.5rem}.msg{color:#6b7280;font-size:1rem;line-height:1.6}footer{margin-top:2rem;font-size:.75rem;opacity:.5}footer a{color:inherit;text-decoration:none}.badge{display:inline-block;padding:.15em .5em;border-radius:.3em;font-size:.85em;font-weight:600;background:#f3f4f6;color:#374151}.badge-dev{background:#fef3c7;color:#92400e}.badge-rc{background:#dbeafe;color:#1e40af}.badge-prod{background:#d1fae5;color:#065f46}</style></head><body><div class="box"><div class="icon">🍰</div><div class="title">Back soon!</div><div class="msg">${message}</div></div><footer><span id="vt">Sugar &amp; Snouts</span></footer><script>fetch('/api/config').then(r=>r.json()).then(cfg=>{const v=cfg.version||'0.0.1',env=cfg.appEnv||'development',isDev=v.includes('-dev.'),isRC=v.includes('-rc'),base=v.split('-')[0],tag=isDev?'v'+base+'-dev.'+v.split('-dev.')[1]:isRC?'v'+base+'-rc':'v'+base,cls=isDev?'badge-dev':isRC?'badge-rc':'badge-prod';document.getElementById('vt').innerHTML='<a href="/admin/">Sugar &amp; Snouts &middot; <span class="badge '+cls+'">'+env+'</span> &middot; '+tag+'</a>'}).catch(()=>{})</script></body></html>`)
    }
  } catch { /* no-op — if DB not ready, allow through */ }
  next()
})

// ─── Static files ─────────────────────────────────────────────────────────────
// New app pages from public/
app.use(express.static(path.join(__dirname, '../public'), { index: false }))
// Legacy static assets (img, css, js) from project root
app.use('/img',        express.static(path.join(__dirname, '../img')))
app.use('/css',        express.static(path.join(__dirname, '../css')))
app.use('/js',         express.static(path.join(__dirname, '../js')))
app.use('/style.css',  (req, res) => res.sendFile(path.join(__dirname, '../style.css')))
app.use('/favicon.jpg',(req, res) => res.sendFile(path.join(__dirname, '../favicon.jpg')))
// Product image uploads
const uploadPath = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(__dirname, '../uploads')
app.use('/uploads', express.static(uploadPath))
// Site images (admin-uploaded homepage images)
const siteImagesPath = process.env.SITE_IMAGES_PATH
  ? path.resolve(process.env.SITE_IMAGES_PATH)
  : path.join(__dirname, '../site-images')
app.use('/site-images', express.static(siteImagesPath))

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  try {
    require('./db/connection').prepare('SELECT 1').get()
    res.json({ ok: true, version: APP_VERSION, uptime: Math.floor(process.uptime()) })
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable' })
  }
})

// ─── Config endpoint ──────────────────────────────────────────────────────────
app.get('/api/config', optionalAuth, (req, res) => {
  const db = require('./db/connection')
  const unread = db.prepare("SELECT COUNT(*) as c FROM contact_messages WHERE is_read = 0").get()
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get()

  res.set('Cache-Control', 'no-store')
  res.json({
    appName:       process.env.APP_NAME || 'Sugar & Snouts',
    appEnv:        APP_ENV,
    version:       APP_VERSION,
    user:          req.user || null,
    unreadMessages: unread.c,
    pendingOrders: pendingOrders.c,
  })
})

// ─── Stats (admin) ────────────────────────────────────────────────────────────
app.get('/api/stats', require('./middleware/auth').requireAuth, (req, res) => {
  const db = require('./db/connection')
  const products    = db.prepare('SELECT COUNT(*) as c FROM products').get()
  const available   = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_available = 1').get()
  const featured    = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_featured = 1').get()
  const orders      = db.prepare('SELECT COUNT(*) as c FROM orders').get()
  const pending     = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get()
  const messages    = db.prepare('SELECT COUNT(*) as c FROM contact_messages WHERE is_read = 0').get()
  const revenue     = db.prepare("SELECT COALESCE(SUM(total),0) as r FROM orders WHERE status != 'cancelled'").get()
  const subscribers = db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers WHERE is_active = 1').get()
  res.json({
    totalProducts:     products.c,
    availableProducts: available.c,
    featuredProducts:  featured.c,
    totalOrders:       orders.c,
    pendingOrders:     pending.c,
    unreadMessages:    messages.c,
    totalRevenue:      revenue.r,
    newsletterSubscribers: subscribers.c,
  })
})

// ─── Analytics (admin) ───────────────────────────────────────────────────────
app.get('/api/admin/analytics', require('./middleware/auth').requireAuth, (req, res) => {
  const db = require('./db/connection')
  const days = Math.min(parseInt(req.query.days || '30'), 365)

  const daily = db.prepare(`
    SELECT date(created_at) as day,
           COUNT(*) as orders,
           COALESCE(SUM(total),0) as revenue
    FROM orders
    WHERE status != 'cancelled'
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY day
    ORDER BY day ASC
  `).all(days)

  const topProducts = db.prepare(`
    SELECT json_extract(item.value, '$.productName') as name,
           SUM(CAST(json_extract(item.value, '$.quantity') AS INTEGER)) as qty,
           SUM(CAST(json_extract(item.value, '$.lineTotal') AS REAL)) as revenue
    FROM orders, json_each(orders.items) as item
    WHERE orders.status != 'cancelled'
      AND orders.created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY name
    ORDER BY qty DESC
    LIMIT 10
  `).all(days)

  res.json({ daily, topProducts })
})

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'))
app.use('/api/products',       require('./routes/products'))
app.use('/api/orders',         require('./routes/orders'))
app.use('/api/contact',        require('./routes/contact'))
app.use('/api/admin/users',    require('./routes/users'))
app.use('/api/settings',       require('./routes/settings'))
app.use('/api/home-examples',  require('./routes/examples'))
app.use('/api/coupons',        require('./routes/coupons'))
app.use('/api/newsletter',     require('./routes/newsletter'))
app.use('/api/pickup-slots',   require('./routes/pickup_slots'))

// ─── Sitemap ──────────────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const db = require('./db/connection')
  const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`
  const products = db.prepare(`
    SELECT id FROM products WHERE is_available = 1
    AND (available_from IS NULL OR available_from <= datetime('now'))
    AND (available_until IS NULL OR available_until >= datetime('now'))
  `).all()

  const staticPages = ['', '/shop', '/contact', '/terms', '/privacy', '/order-status']
  const urls = [
    ...staticPages.map(p => `  <url><loc>${baseUrl}${p}</loc><changefreq>weekly</changefreq></url>`),
    ...products.map(p => `  <url><loc>${baseUrl}/shop#product-${p.id}</loc><changefreq>weekly</changefreq></url>`),
  ].join('\n')

  res.set('Content-Type', 'application/xml')
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`)
})

// ─── Page routes ──────────────────────────────────────────────────────────────
const pub = (file) => path.join(__dirname, '../public', file)
app.get('/',                 (req, res) => res.sendFile(pub('index.html')))
app.get('/shop',             (req, res) => res.sendFile(pub('shop.html')))
app.get('/shop.html',        (req, res) => res.sendFile(pub('shop.html')))
app.get('/contact',          (req, res) => res.sendFile(pub('contact.html')))
app.get('/contact.html',     (req, res) => res.sendFile(pub('contact.html')))
app.get('/order-status',     (req, res) => res.sendFile(pub('order-status.html')))
app.get('/terms',            (req, res) => res.sendFile(pub('terms.html')))
app.get('/privacy',          (req, res) => res.sendFile(pub('privacy.html')))
app.get('/admin/setup', (req, res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.sendFile(pub('admin/setup.html')) })
app.get('/admin', (req, res) => {
  if (!req.originalUrl.startsWith('/admin/')) return res.redirect('/admin/')
  const db = require('./db/connection')
  const count = db.prepare('SELECT COUNT(*) as c FROM admin_users').get()
  if (count.c === 0) return res.redirect('/admin/setup')
  res.set('X-Robots-Tag', 'noindex, nofollow')
  res.sendFile(pub('admin/login.html'))
})
app.get('/admin/dashboard',  (req, res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.sendFile(pub('admin/dashboard.html')) })

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
  res.status(404).sendFile(pub('index.html'))
})

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || 3000)
app.listen(PORT, () => {
  console.log(`\n  🍰  Sugar & Snouts  ·  ${APP_ENV}  ·  v${APP_VERSION}`)
  console.log(`  🌐  http://localhost:${PORT}\n`)
})
