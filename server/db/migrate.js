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

  // ── Safe column addition: products.category_id ───────────────────────────
  const productCols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name)
  if (!productCols.includes('category_id')) {
    db.exec('ALTER TABLE products ADD COLUMN category_id TEXT')
    // Backfill: map old category value into category_id
    db.exec("UPDATE products SET category_id = category WHERE category_id IS NULL")
    console.log('  ✓  Added column products.category_id (backfilled from category)')
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

  // ── Seed default admin if none exists ────────────────────────────────────
  const count = db.prepare('SELECT COUNT(*) as c FROM admin_users').get()
  if (count.c === 0) {
    const { hashPassword } = require('../auth-utils')
    const email    = process.env.ADMIN_EMAIL    || 'admin@sugarandsnouts.co.uk'
    const password = process.env.ADMIN_PASSWORD || 'Admin1234!'

    // hashPassword is async — run synchronously for seed via child_process trick
    // or use the sync bcrypt path only here in migration
    const bcrypt = require('bcryptjs')
    const pepper  = process.env.PASSWORD_PEPPER || ''
    const crypto  = require('crypto')
    const peppered = pepper
      ? crypto.createHmac('sha256', pepper).update(password).digest('hex')
      : password
    const hash = bcrypt.hashSync(peppered, 12)

    db.prepare(`
      INSERT INTO admin_users (id, name, email, password, role, is_active, token_version)
      VALUES (?, ?, ?, ?, 'admin', 1, 0)
    `).run(uuidv4(), 'Admin', email.toLowerCase().trim(), hash)
    console.log(`  ✓  Default admin created: ${email}`)
    console.log(`  ⚠   Change the admin password at first login!`)
  }

  console.log('  ✓  Database migration complete')
}

migrate()
