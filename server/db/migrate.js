'use strict'
/**
 * migrate.js — Creates the SQLite schema for Sugar & Snouts.
 * Run with: node server/db/migrate.js
 * Safe to re-run — uses IF NOT EXISTS throughout.
 */
const path = require('path')
const fs   = require('fs')

const root = path.join(__dirname, '../../')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) return
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k && !process.env[k]) process.env[k] = v
  })
  return true
}

const explicitEnv = process.env.NODE_ENV
if (explicitEnv) loadEnvFile(path.join(root, `.env.${explicitEnv}`))
if (!process.env.DATABASE_PATH) {
  for (const e of ['development', 'staging', 'production']) {
    if (loadEnvFile(path.join(root, `.env.${e}`)) && process.env.DATABASE_PATH) break
  }
}

const db     = require('./connection')
const { v4: uuidv4 } = require('uuid')

function migrate() {
  db.exec(`
    -- ── Admin Users ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS admin_users (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      email           TEXT NOT NULL UNIQUE,
      password        TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','editor')),
      is_active       INTEGER NOT NULL DEFAULT 1,
      avatar          TEXT,
      token_version   INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Products ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT,
      category         TEXT NOT NULL DEFAULT 'cookies'
                         CHECK (category IN ('cookies','cupcakes','woof_treats','pur_treats','other')),
      price            REAL NOT NULL,
      offer_price      REAL,
      offer_expires_at TEXT,
      image_path       TEXT,
      is_available     INTEGER NOT NULL DEFAULT 1,
      is_featured      INTEGER NOT NULL DEFAULT 0,
      is_recommended   INTEGER NOT NULL DEFAULT 0,
      is_new           INTEGER NOT NULL DEFAULT 0,
      quantity_limit   INTEGER,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Orders ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      customer_name   TEXT NOT NULL,
      customer_email  TEXT NOT NULL,
      customer_phone  TEXT,
      items           TEXT NOT NULL,
      total           REAL NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','confirmed','ready','collected','cancelled')),
      notes           TEXT,
      admin_notes     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Contact Messages ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS contact_messages (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      message    TEXT NOT NULL,
      optin      INTEGER NOT NULL DEFAULT 0,
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Audit Log ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      actor_id    TEXT,
      action      TEXT NOT NULL,
      entity_type TEXT,
      entity_id   TEXT,
      entity_name TEXT,
      meta        TEXT,
      ip          TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Product Categories ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS product_categories (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── App Preferences ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS app_preferences (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Home Examples ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS home_examples (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      image_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // ── Safe column additions for existing DBs (idempotent) ─────────────────
  const existingCols = db.prepare("PRAGMA table_info(admin_users)").all().map(c => c.name)
  const addIfMissing = (col, def) => {
    if (!existingCols.includes(col)) {
      db.exec(`ALTER TABLE admin_users ADD COLUMN ${col} ${def}`)
      console.log(`  ✓  Added column admin_users.${col}`)
    }
  }
  addIfMissing('is_active',       'INTEGER NOT NULL DEFAULT 1')
  addIfMissing('token_version',   'INTEGER NOT NULL DEFAULT 0')
  addIfMissing('failed_attempts', 'INTEGER NOT NULL DEFAULT 0')
  addIfMissing('locked_until',    'TEXT')

  // ── Safe column additions: products ─────────────────────────────────────
  const productCols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name)
  if (!productCols.includes('category_id')) {
    db.exec('ALTER TABLE products ADD COLUMN category_id TEXT')
    // Backfill: map old category value into category_id
    db.exec("UPDATE products SET category_id = category WHERE category_id IS NULL")
    console.log('  ✓  Added column products.category_id (backfilled from category)')
  }
  if (!productCols.includes('allergen_info')) {
    db.exec('ALTER TABLE products ADD COLUMN allergen_info TEXT')
    console.log('  ✓  Added column products.allergen_info')
  }
  if (!productCols.includes('ingredients')) {
    db.exec('ALTER TABLE products ADD COLUMN ingredients TEXT')
    console.log('  ✓  Added column products.ingredients')
  }
  if (!productCols.includes('is_limited_time')) {
    db.exec('ALTER TABLE products ADD COLUMN is_limited_time INTEGER NOT NULL DEFAULT 0')
    console.log('  ✓  Added column products.is_limited_time')
  }
  if (!productCols.includes('is_out_of_stock')) {
    db.exec('ALTER TABLE products ADD COLUMN is_out_of_stock INTEGER NOT NULL DEFAULT 0')
    console.log('  ✓  Added column products.is_out_of_stock')
  }
  if (!productCols.includes('stock_amount')) {
    db.exec('ALTER TABLE products ADD COLUMN stock_amount INTEGER')
    console.log('  ✓  Added column products.stock_amount')
  }

  // ── Seed default product categories if none exist ────────────────────────
  const catCount = db.prepare('SELECT COUNT(*) as c FROM product_categories').get()
  if (catCount.c === 0) {
    const defaultCategories = [
      { id: 'cookies',     name: 'Cookies',     sort_order: 1 },
      { id: 'cupcakes',    name: 'Cupcakes',    sort_order: 2 },
      { id: 'woof_treats', name: 'Woof Treats', sort_order: 3 },
      { id: 'pur_treats',  name: 'Pur Treats',  sort_order: 4 },
      { id: 'other',       name: 'Other',       sort_order: 5 },
    ]
    const insertCat = db.prepare('INSERT OR IGNORE INTO product_categories (id, name, sort_order) VALUES (?, ?, ?)')
    defaultCategories.forEach(c => insertCat.run(c.id, c.name, c.sort_order))
    console.log('  ✓  Default product categories seeded')
  }

  // ── Seed default app preferences (INSERT OR IGNORE so new keys are backfilled) ─
  const defaults = [
    ['shop_open',                 '1'],
    ['announcement',              ''],
    ['announcement_active',       '0'],
    ['hero_tagline',              'Baked goods for people and pets, joining you together for a sweet treat 🍪 🧁'],
    // General
    ['maintenance_mode',          '0'],
    ['maintenance_message',       'We\'ll be back soon!'],
    ['site_name',                 'Sugar & Snouts'],
    ['footer_text',               ''],
    // Shop / Orders
    ['shop_closed_message',       'The shop is currently closed for new orders.'],
    ['delivery_enabled',          '0'],
    ['delivery_fee',              '0'],
    ['minimum_order_value',       '0'],
    ['allergen_notice',           ''],
    ['payment_methods',           ''],
    ['order_form_intro',          ''],
    ['order_max_days_ahead',      ''],
    ['order_daily_limit',         ''],
    // Homepage section visibility
    ['show_featured_section',     '1'],
    ['show_new_section',          '1'],
    ['show_examples_section',     '1'],
    ['show_assistants_section',   '1'],
    ['assistants_text',           ''],
    // Email / notifications
    ['order_notification_email',  ''],
    ['send_customer_confirmation','1'],
    ['email_from_name',           ''],
    // SEO
    ['google_analytics_id',       ''],
  ]
  const insertPref = db.prepare("INSERT OR IGNORE INTO app_preferences (key, value) VALUES (?, ?)")
  defaults.forEach(([k, v]) => insertPref.run(k, v))
  console.log('  ✓  Default app preferences seeded')

  // ── Seed default home examples if none exist ─────────────────────────────────
  const exCount = db.prepare('SELECT COUNT(*) as c FROM home_examples').get()
  if (exCount.c === 0) {
    const defaultExamples = [
      { id: 'cookies',  title: 'Cookies',     sort_order: 1 },
      { id: 'cupcakes', title: 'Cupcakes',    sort_order: 2 },
      { id: 'woof',     title: 'Woof Treats', sort_order: 3 },
      { id: 'pur',      title: 'Pur Treats',  sort_order: 4 },
    ]
    const insertEx = db.prepare('INSERT OR IGNORE INTO home_examples (id, title, sort_order) VALUES (?, ?, ?)')
    defaultExamples.forEach(e => insertEx.run(e.id, e.title, e.sort_order))
    console.log('  ✓  Default home examples seeded')
  }

  // Admin account is created via the first-run setup UI at /admin/setup
  // No default admin is seeded here — visit /admin/ on a fresh install to get started.

  console.log('  ✓  Database migration complete')
}

migrate()
