'use strict'
const jwt = require('jsonwebtoken')
const db  = require('../db/connection')

function cookieOpts() {
  const secure = process.env.COOKIE_SECURE === 'true'
  return { httpOnly: true, secure, sameSite: secure ? 'strict' : 'lax', path: '/' }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token
  if (!token) {
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' })
    return res.redirect('/admin/')
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    // Validate token_version — supports immediate revocation (sign out all devices)
    const user = db.prepare(
      'SELECT id, name, email, role, is_active, token_version, avatar FROM admin_users WHERE id = ?'
    ).get(payload.id)

    if (!user) {
      res.clearCookie('token', cookieOpts())
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'User not found' })
      return res.redirect('/admin/')
    }

    if (!user.is_active) {
      res.clearCookie('token', cookieOpts())
      if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'Account deactivated' })
      return res.redirect('/admin/')
    }

    if ((user.token_version || 0) !== (payload.tv || 0)) {
      res.clearCookie('token', cookieOpts())
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Session revoked' })
      return res.redirect('/admin/')
    }

    req.user = user
    next()
  } catch {
    res.clearCookie('token', cookieOpts())
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Session expired' })
    return res.redirect('/admin/')
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.token
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET)
      const user = db.prepare(
        'SELECT id, name, email, role, is_active, token_version FROM admin_users WHERE id = ?'
      ).get(payload.id)
      if (user && user.is_active && (user.token_version || 0) === (payload.tv || 0)) {
        req.user = user
      } else {
        res.clearCookie('token', cookieOpts())
      }
    } catch {
      res.clearCookie('token', cookieOpts())
    }
  }
  next()
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' })
    next()
  })
}

module.exports = { requireAuth, requireAdmin, optionalAuth, cookieOpts }
