'use strict'
const db = require('./db/connection')
const { v4: uuidv4 } = require('uuid')

/**
 * audit(actorId, action, entityType, entityId, entityName, meta)
 *
 * action examples: 'admin.login', 'admin.logout', 'product.create', 'product.update',
 *                  'product.delete', 'order.status_change', 'settings.password_change',
 *                  'auth.failed_login'
 */
function audit(actorId, action, entityType, entityId, entityName, meta) {
  try {
    db.prepare(`
      INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, entity_name, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      uuidv4(),
      actorId    || null,
      action,
      entityType || null,
      entityId   || null,
      entityName || null,
      meta ? JSON.stringify(meta) : null
    )
  } catch (err) {
    console.error('[audit] write failed:', err.message)
  }
}

module.exports = audit
