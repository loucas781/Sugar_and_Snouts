/* Sugar & Snouts — shared app utilities */
'use strict'

// ── Version tag (matches ForgeShift / ForgeTrack pattern) ────────────────────
async function initVersionTag(el) {
  if (!el) return
  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    const v   = cfg.version || '0.0.1'
    const env = cfg.appEnv  || 'development'
    const isDev = v.includes('-dev.'), isRC = v.includes('-rc')
    const base   = v.split('-')[0]
    const devNum = isDev ? v.split('-dev.')[1] : null
    const tag    = isDev ? `v${base}-dev.${devNum}` : isRC ? `v${base}-rc` : `v${base}`
    const cls    = isDev ? 'badge-dev' : isRC ? 'badge-rc' : 'badge-prod'
    el.innerHTML = `<a href="/admin/" style="text-decoration:none;color:inherit">Sugar &amp; Snouts &middot; <span class="version-tag ${cls}">${env}</span> &middot; ${tag}</a>`
  } catch { /* no-op */ }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null
function showToast(msg, type = '') {
  let toast = document.getElementById('snsToast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'snsToast'
    document.body.appendChild(toast)
  }
  const icon = type === 'error' ? '✕' : '✓'
  toast.className = `sns-toast ${type}`
  toast.innerHTML = `<span class="sns-toast__icon">${icon}</span><span class="sns-toast__msg">${msg}</span>`
  requestAnimationFrame(() => toast.classList.add('show'))
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 3000)
}

// ── Cart ──────────────────────────────────────────────────────────────────────
const Cart = {
  _key: 'sns_cart',

  get() {
    try { return JSON.parse(localStorage.getItem(this._key)) || [] } catch { return [] }
  },

  save(items) {
    localStorage.setItem(this._key, JSON.stringify(items))
    this._dispatch()
  },

  add(product, qty = 1) {
    const items = this.get()
    const existing = items.find(i => i.id === product.id)
    if (existing) {
      const newQty = existing.quantity + qty
      if (product.quantityLimit && newQty > product.quantityLimit) {
        showToast(`Max ${product.quantityLimit} per order for "${product.name}"`, 'error')
        return false
      }
      existing.quantity = newQty
    } else {
      if (product.quantityLimit && qty > product.quantityLimit) {
        showToast(`Max ${product.quantityLimit} per order for "${product.name}"`, 'error')
        return false
      }
      items.push({
        id:           product.id,
        name:         product.name,
        price:        product.offerPrice ?? product.price,
        imagePath:    product.imagePath,
        quantityLimit: product.quantityLimit,
        quantity:     qty
      })
    }
    this.save(items)
    showToast(`Added "${product.name}" to cart!`, 'success')
    return true
  },

  update(id, qty) {
    let items = this.get()
    if (qty <= 0) {
      items = items.filter(i => i.id !== id)
    } else {
      const item = items.find(i => i.id === id)
      if (item) {
        if (item.quantityLimit && qty > item.quantityLimit) {
          showToast(`Max ${item.quantityLimit} per order`, 'error')
          return
        }
        item.quantity = qty
      }
    }
    this.save(items)
  },

  clear() { this.save([]) },

  total() {
    return this.get().reduce((sum, i) => sum + i.price * i.quantity, 0)
  },

  count() {
    return this.get().reduce((sum, i) => sum + i.quantity, 0)
  },

  _dispatch() {
    window.dispatchEvent(new Event('cartUpdated'))
  }
}

// ── Cart Drawer ───────────────────────────────────────────────────────────────
function initCartDrawer() {
  const overlay = document.getElementById('cartOverlay')
  const drawer  = document.getElementById('cartDrawer')
  if (!overlay || !drawer) return

  function open() {
    overlay.classList.add('open')
    drawer.classList.add('open')
    renderCartDrawer()
  }
  function close() {
    overlay.classList.remove('open')
    drawer.classList.remove('open')
  }

  document.querySelectorAll('[data-cart-open]').forEach(btn => btn.addEventListener('click', open))
  document.getElementById('cartClose')?.addEventListener('click', close)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  window.addEventListener('cartUpdated', () => {
    renderCartDrawer()
    updateCartBadge()
  })

  updateCartBadge()
}

function updateCartBadge() {
  const badge = document.getElementById('cartCount')
  if (!badge) return
  const count = Cart.count()
  badge.textContent = count
  badge.style.display = count > 0 ? 'flex' : 'none'
}

function renderCartDrawer() {
  const body = document.getElementById('cartBody')
  if (!body) return
  const items = Cart.get()

  if (!items.length) {
    body.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <p>Your cart is empty</p>
        <small>Browse the shop to add something delicious!</small>
      </div>`
  } else {
    body.innerHTML = items.map(item => `
      <div class="cart-item" data-id="${item.id}">
        ${item.imagePath
          ? `<img src="${item.imagePath}" class="cart-item__img" alt="${item.name}">`
          : `<div class="cart-item__img" style="display:flex;align-items:center;justify-content:center;font-size:1.8rem">🧁</div>`
        }
        <div class="cart-item__info">
          <div class="cart-item__name">${item.name}</div>
          <div class="cart-item__price">£${item.price.toFixed(2)} each</div>
          <div class="cart-item__controls">
            <button class="qty-btn" data-qty-dec="${item.id}">−</button>
            <span class="qty-display">${item.quantity}</span>
            <button class="qty-btn" data-qty-inc="${item.id}">+</button>
          </div>
        </div>
        <button class="cart-item__remove" data-remove="${item.id}" title="Remove">✕</button>
      </div>`).join('')

    body.querySelectorAll('[data-qty-dec]').forEach(btn =>
      btn.addEventListener('click', () => Cart.update(btn.dataset.qtyDec, Cart.get().find(i => i.id === btn.dataset.qtyDec)?.quantity - 1)))
    body.querySelectorAll('[data-qty-inc]').forEach(btn =>
      btn.addEventListener('click', () => Cart.update(btn.dataset.qtyInc, Cart.get().find(i => i.id === btn.dataset.qtyInc)?.quantity + 1)))
    body.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', () => Cart.update(btn.dataset.remove, 0)))
  }

  const total  = document.getElementById('cartTotal')
  const footer = document.getElementById('cartFooter')
  if (total) total.textContent = `£${Cart.total().toFixed(2)}`
  if (footer) footer.style.display = items.length ? 'block' : 'none'
}

// ── Order Modal ───────────────────────────────────────────────────────────────
function initOrderModal() {
  const overlay = document.getElementById('orderModalOverlay')
  if (!overlay) return

  const btn = document.getElementById('cartCheckout')
  btn?.addEventListener('click', () => {
    if (btn.disabled || !Cart.count() || !_shopOpen) return
    overlay.classList.add('open')
    renderOrderSummary()
  })

  document.getElementById('orderModalClose')?.addEventListener('click', () => overlay.classList.remove('open'))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open') })

  document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = e.target.querySelector('[type=submit]')
    btn.disabled = true
    btn.textContent = 'Submitting…'
    try {
      const data = new FormData(e.target)
      const body = {
        customerName:  data.get('name'),
        customerEmail: data.get('email'),
        customerPhone: data.get('phone'),
        notes:         data.get('notes'),
        items:         Cart.get().map(i => ({ productId: i.id, quantity: i.quantity }))
      }
      const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Order failed')
      Cart.clear()
      overlay.classList.remove('open')
      showToast('🎉 Order placed! We\'ll be in touch soon.', 'success')
      e.target.reset()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      btn.disabled = false
      btn.textContent = 'Place Order'
    }
  })
}

function renderOrderSummary() {
  const el = document.getElementById('orderSummary')
  if (!el) return
  const items = Cart.get()
  el.innerHTML = items.map(i => `
    <div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #f0f0f0;font-size:.9rem">
      <span>${i.name} × ${i.quantity}</span>
      <span>£${(i.price * i.quantity).toFixed(2)}</span>
    </div>`).join('')
  + `<div style="display:flex;justify-content:space-between;padding:.7rem 0;font-weight:700">
      <span>Total</span><span>£${Cart.total().toFixed(2)}</span>
    </div>`
}

// ── Admin nav link (shown only when authenticated) ────────────────────────────
async function initAdminLink() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (!res.ok) return
    const nav = document.querySelector('.navbar-nav')
    if (!nav) return
    const li = document.createElement('li')
    li.className = 'nav-item ms-lg-1'
    li.innerHTML = '<a class="nav-link" href="/admin/dashboard">Admin</a>'
    nav.appendChild(li)
  } catch { /* not authenticated or no nav — no-op */ }
}

// ── Site status: announcement banner + shop-closed state ─────────────────────
let _shopOpen = true // optimistic default until settings load

async function initAnnouncement() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())

    if (s.announcement_active === '1' && s.announcement) {
      const banner = document.createElement('div')
      banner.className = 'sns-announcement'
      banner.textContent = s.announcement
      document.body.insertBefore(banner, document.body.firstChild)
    }

    _shopOpen = s.shop_open !== '0'

    if (!_shopOpen) {
      const checkoutBtn = document.getElementById('cartCheckout')
      if (checkoutBtn) {
        checkoutBtn.disabled = true
        checkoutBtn.textContent = '🔒 Shop Currently Closed'
      }

      // Show a visible closed banner on pages that have the shop grid
      const shopGrid = document.getElementById('shopGrid')
      if (shopGrid) {
        const closed = document.createElement('div')
        closed.className = 'sns-shop-closed-banner'
        closed.textContent = 'The shop is currently closed. Orders are not being accepted at this time.'
        shopGrid.parentElement.insertBefore(closed, shopGrid)
      }
    }
  } catch { /* no-op */ }
}

// ── Init on DOM ready ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initVersionTag(document.getElementById('versionTag'))
  initCartDrawer()
  initOrderModal()
  initAdminLink()
  initAnnouncement()
})
