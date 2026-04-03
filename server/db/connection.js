'use strict'
const path    = require('path')
const fs      = require('fs')
const Database = require('better-sqlite3')

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '../../data/sugarandsnouts.db')

const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

module.exports = db
