/* Sugar & Snouts — shared app utilities */
'use strict'

// ── Version tag ───────────────────────────────────────────────────────────────
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
    if (product.isOutOfStock) {
      showToast(`"${product.name}" is out of stock`, 'error')
      return false
    }
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
        <button class="cart-item__remove" data-remove="${item.id}" title="Remove item">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>
          </svg>
        </button>
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
let _appliedCoupon   = null
let _orderSettings   = {}
let _paypalLoaded    = false
let _selectedDelivery = 'pickup'
let _paypalButtons   = null

function _loadPayPalSDK(clientId, currency = 'GBP') {
  return new Promise((resolve, reject) => {
    if (window.paypal) { resolve(); return }
    if (_paypalLoaded) { resolve(); return }
    _paypalLoaded = true
    const s = document.createElement('script')
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture`
    s.onload  = resolve
    s.onerror = () => reject(new Error('Failed to load PayPal SDK'))
    document.head.appendChild(s)
  })
}

function selectDeliveryType(type) {
  _selectedDelivery = type
  document.querySelectorAll('.delivery-type-btn').forEach(b => b.classList.toggle('active', b.dataset.dtype === type))
  const addrWrap = document.getElementById('orderDeliveryAddressWrap')
  const slotWrap = document.getElementById('orderPickupSlotWrap')
  if (addrWrap) addrWrap.style.display = type === 'delivery' ? '' : 'none'
  if (slotWrap) slotWrap.style.display  = type === 'pickup'  ? '' : 'none'
  renderOrderSummary()
}

async function initOrderModal() {
  const overlay = document.getElementById('orderModalOverlay')
  if (!overlay) return

  let settings = {}
  try { settings = await fetch('/api/settings').then(r => r.json()) } catch { /* no-op */ }
  _orderSettings = settings

  // Load PayPal config
  let paypalCfg = { enabled: false, clientId: null }
  try { paypalCfg = await fetch('/api/paypal/config').then(r => r.json()) } catch { /* no-op */ }
  if (paypalCfg.enabled && paypalCfg.clientId) {
    try { await _loadPayPalSDK(paypalCfg.clientId) } catch { paypalCfg.enabled = false }
  }

  const btn = document.getElementById('cartCheckout')
  btn?.addEventListener('click', async () => {
    if (btn.disabled || !Cart.count() || !_shopOpen) return
    _appliedCoupon = null
    _selectedDelivery = 'pickup'

    // Delivery type toggle
    const deliveryTypeWrap = document.getElementById('orderDeliveryTypeWrap')
    if (deliveryTypeWrap) {
      if (settings.delivery_enabled === '1') {
        deliveryTypeWrap.innerHTML = `
          <label class="sns-label">Order Type</label>
          <div style="display:flex;gap:.5rem">
            <button type="button" class="delivery-type-btn active" data-dtype="pickup" onclick="selectDeliveryType('pickup')" style="flex:1;padding:.5rem;border:2px solid var(--pink-dark);border-radius:8px;background:var(--pink);cursor:pointer;font-size:.9rem">🏪 Pickup</button>
            <button type="button" class="delivery-type-btn" data-dtype="delivery" onclick="selectDeliveryType('delivery')" style="flex:1;padding:.5rem;border:2px solid #e2e8f0;border-radius:8px;background:#f8fafc;cursor:pointer;font-size:.9rem">🚚 Delivery</button>
          </div>`
        deliveryTypeWrap.style.display = ''
      } else { deliveryTypeWrap.style.display = 'none' }
    }

    const addrWrap = document.getElementById('orderDeliveryAddressWrap')
    if (addrWrap) addrWrap.style.display = 'none'

    // Pickup slot selector
    const slotsWrap = document.getElementById('orderPickupSlotWrap')
    if (slotsWrap) {
      if (settings.pickup_slots_enabled === '1') {
        try {
          const slots = await fetch('/api/pickup-slots').then(r => r.json())
          if (slots.length) {
            slotsWrap.innerHTML = `
              <label class="sns-label" for="orderPickupSlot">Pickup Slot</label>
              <select class="sns-input" id="orderPickupSlot" name="pickupSlot">
                <option value="">— Select a pickup slot —</option>
                ${slots.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
              </select>`
            slotsWrap.style.display = ''
          } else { slotsWrap.style.display = 'none' }
        } catch { slotsWrap.style.display = 'none' }
      } else { slotsWrap.style.display = 'none' }
    }

    // Pre-order date picker
    const dateWrap = document.getElementById('orderDateWrap')
    if (dateWrap) {
      const maxDays = parseInt(settings.order_max_days_ahead || '0')
      if (maxDays > 0) {
        const today = new Date()
        const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + maxDays)
        const fmt = d => d.toISOString().split('T')[0]
        dateWrap.innerHTML = `
          <label class="sns-label" for="orderDate">Preferred Date</label>
          <input class="sns-input" type="date" id="orderDate" name="orderDate"
            min="${fmt(today)}" max="${fmt(maxDate)}">`
        dateWrap.style.display = ''
      } else { dateWrap.style.display = 'none' }
    }

    // PayPal buttons
    const ppContainer = document.getElementById('paypalButtonContainer')
    const submitBtn   = document.getElementById('orderSubmitBtn')
    if (ppContainer) {
      if (paypalCfg.enabled && window.paypal) {
        if (submitBtn) submitBtn.style.display = 'none'
        ppContainer.style.display = ''
        ppContainer.innerHTML = ''
        if (_paypalButtons) { try { _paypalButtons.close() } catch { /* no-op */ } }
        _paypalButtons = window.paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
          createOrder: async () => {
            const total = _calcOrderTotal()
            const res   = await fetch('/api/paypal/create-order', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ amount: total.toFixed(2) }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Could not create PayPal order')
            return json.orderId
          },
          onApprove: async (data) => {
            const captureRes = await fetch('/api/paypal/capture-order', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ paypalOrderId: data.orderID }),
            })
            const captureJson = await captureRes.json()
            if (!captureRes.ok) throw new Error(captureJson.error || 'Payment capture failed')
            await _submitOrder(paypalCfg.enabled ? data.orderID : null, captureJson.captureId)
          },
          onError: (err) => { showToast('PayPal error: ' + (err.message || 'Please try again'), 'error') },
        })
        _paypalButtons.render('#paypalButtonContainer')
      } else {
        ppContainer.style.display = 'none'
        if (submitBtn) submitBtn.style.display = ''
      }
    }

    overlay.classList.add('open')
    renderOrderSummary()
  })

  document.getElementById('orderModalClose')?.addEventListener('click', () => {
    overlay.classList.remove('open'); _appliedCoupon = null
  })
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.classList.remove('open'); _appliedCoupon = null }
  })

  // Coupon apply button
  document.getElementById('applyCouponBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('couponInput')
    const code  = input?.value.trim()
    if (!code) return
    const applyBtn = document.getElementById('applyCouponBtn')
    applyBtn.disabled = true
    applyBtn.textContent = '...'
    try {
      const res  = await fetch(`/api/coupons/validate?code=${encodeURIComponent(code)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      _appliedCoupon = json
      renderOrderSummary()
      showToast(`Coupon applied: ${json.type === 'percentage' ? `${json.value}% off` : `£${json.value.toFixed(2)} off`}`, 'success')
    } catch (err) {
      _appliedCoupon = null
      renderOrderSummary()
      showToast(err.message, 'error')
    } finally {
      applyBtn.disabled = false
      applyBtn.textContent = 'Apply'
    }
  })

  document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const submitBtn = e.target.querySelector('[type=submit]')
    submitBtn.disabled = true
    submitBtn.textContent = 'Submitting…'
    try {
      await _submitOrder(null, null)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Place Order'
    }
  })
}

function _calcOrderTotal() {
  const settings = _orderSettings
  const subtotal = Cart.total()
  let discount = 0
  if (_appliedCoupon) {
    discount = _appliedCoupon.type === 'percentage'
      ? Math.round(subtotal * (_appliedCoupon.value / 100) * 100) / 100
      : Math.min(_appliedCoupon.value, subtotal)
  }
  let total = Math.max(0, subtotal - discount)
  if (_selectedDelivery === 'delivery' && settings.delivery_enabled === '1') {
    total += parseFloat(settings.delivery_fee || '0')
  }
  return Math.round(total * 100) / 100
}

async function _submitOrder(paypalOrderId, paypalCaptureId) {
  const overlay = document.getElementById('orderModalOverlay')
  const form    = document.getElementById('orderForm')
  const data    = new FormData(form)

  const deliveryAddress = document.getElementById('orderDeliveryAddress')?.value?.trim()
  if (_selectedDelivery === 'delivery' && _orderSettings.delivery_enabled === '1' && !deliveryAddress) {
    throw new Error('Delivery address is required')
  }

  const body = {
    customerName:  data.get('name'),
    customerEmail: data.get('email'),
    customerPhone: data.get('phone'),
    notes:         data.get('notes'),
    items:         Cart.get().map(i => ({ productId: i.id, quantity: i.quantity })),
    couponCode:    _appliedCoupon ? _appliedCoupon.code : undefined,
    pickupSlot:    data.get('pickupSlot') || undefined,
    orderDate:     data.get('orderDate')  || undefined,
    deliveryType:  _selectedDelivery,
    deliveryAddress: _selectedDelivery === 'delivery' ? deliveryAddress : undefined,
    paypalOrderId:   paypalOrderId  || undefined,
    paypalCaptureId: paypalCaptureId || undefined,
  }

  const res  = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Order failed')

  Cart.clear()
  overlay.classList.remove('open')
  _appliedCoupon = null
  showToast('🎉 Order placed! We\'ll be in touch soon.', 'success')
  form.reset()
}

function renderOrderSummary() {
  const el = document.getElementById('orderSummary')
  if (!el) return
  const settings = _orderSettings
  const items    = Cart.get()
  const subtotal = Cart.total()

  let discountAmount = 0
  let discountLine   = ''
  if (_appliedCoupon) {
    discountAmount = _appliedCoupon.type === 'percentage'
      ? Math.round(subtotal * (_appliedCoupon.value / 100) * 100) / 100
      : Math.min(_appliedCoupon.value, subtotal)
    discountLine = `
      <div style="display:flex;justify-content:space-between;padding:.4rem 0;font-size:.85rem;color:#888">
        <span>Discount (${_appliedCoupon.code})</span>
        <span style="color:#22c55e">−£${discountAmount.toFixed(2)}</span>
      </div>`
  }

  let afterDiscount = Math.max(0, subtotal - discountAmount)

  let deliveryLine = ''
  if (_selectedDelivery === 'delivery' && settings.delivery_enabled === '1') {
    const fee = parseFloat(settings.delivery_fee || '0')
    afterDiscount = Math.round((afterDiscount + fee) * 100) / 100
    deliveryLine = `
      <div style="display:flex;justify-content:space-between;padding:.4rem 0;font-size:.85rem;color:#555">
        <span>Delivery fee</span>
        <span>${fee > 0 ? `£${fee.toFixed(2)}` : 'Free'}</span>
      </div>`
  }

  let vatLine = ''
  if (settings.vat_enabled === '1') {
    const rate = parseFloat(settings.vat_rate || '20')
    const inclusive = settings.vat_inclusive !== '0'
    const vatAmount = inclusive
      ? Math.round(afterDiscount * (rate / (100 + rate)) * 100) / 100
      : Math.round(afterDiscount * (rate / 100) * 100) / 100
    if (!inclusive) afterDiscount = Math.round((afterDiscount + vatAmount) * 100) / 100
    vatLine = `
      <div style="display:flex;justify-content:space-between;padding:.4rem 0;font-size:.82rem;color:#888">
        <span>VAT (${rate}%${inclusive ? ' incl.' : ''})</span>
        <span>£${vatAmount.toFixed(2)}</span>
      </div>`
  }

  el.innerHTML = items.map(i => `
    <div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #f0f0f0;font-size:.9rem">
      <span>${i.name} × ${i.quantity}</span>
      <span>£${(i.price * i.quantity).toFixed(2)}</span>
    </div>`).join('')
    + discountLine + deliveryLine + vatLine
    + `<div style="display:flex;justify-content:space-between;padding:.7rem 0;font-weight:700">
      <span>Total</span><span>£${afterDiscount.toFixed(2)}</span>
    </div>`
}

// ── Product Reviews ───────────────────────────────────────────────────────────
let _reviewProductId  = null
let _reviewStarRating = 0

function toggleReviewForm() {
  const form = document.getElementById('pdReviewForm')
  if (!form) return
  const visible = form.style.display !== 'none'
  form.style.display = visible ? 'none' : ''
  if (!visible) {
    document.getElementById('reviewName').value    = ''
    document.getElementById('reviewEmail').value   = ''
    document.getElementById('reviewComment').value = ''
    setReviewStars(0)
    const msg = document.getElementById('reviewFormMsg')
    if (msg) msg.style.display = 'none'
  }
}

function setReviewStars(n) {
  _reviewStarRating = n
  document.querySelectorAll('#reviewStarPicker span').forEach((s, i) => {
    s.textContent = i < n ? '★' : '☆'
    s.style.color = i < n ? '#f59e0b' : '#d1d5db'
  })
}

async function loadProductReviews(productId) {
  _reviewProductId = productId
  const section = document.getElementById('pdReviewsSection')
  const list    = document.getElementById('pdReviewsList')
  const avgEl   = document.getElementById('pdReviewsAvg')
  if (!section || !list) return

  try {
    const data = await fetch(`/api/reviews/${productId}`).then(r => r.json())
    if (data.count === 0) {
      list.innerHTML = '<p style="font-size:.85rem;color:#9ca3af;margin:0">No reviews yet — be the first!</p>'
      if (avgEl) avgEl.textContent = ''
    } else {
      if (avgEl) avgEl.textContent = `${'★'.repeat(Math.round(data.avgRating))} ${data.avgRating} (${data.count})`
      list.innerHTML = data.reviews.map(r => `
        <div style="padding:.6rem 0;border-bottom:1px solid #f5f5f5">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem">
            <span style="color:#f59e0b">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
            <strong style="font-size:.85rem">${r.customer_name}</strong>
            <span style="font-size:.75rem;color:#9ca3af">${new Date(r.created_at).toLocaleDateString('en-GB')}</span>
          </div>
          ${r.comment ? `<p style="margin:0;font-size:.85rem;color:#374151">${r.comment}</p>` : ''}
        </div>`).join('')
    }
    section.style.display = ''
  } catch { section.style.display = 'none' }

  // Star picker events
  document.querySelectorAll('#reviewStarPicker span').forEach((s, i) => {
    s.addEventListener('click',      () => setReviewStars(i + 1))
    s.addEventListener('mouseenter', () => document.querySelectorAll('#reviewStarPicker span').forEach((x, j) => { x.textContent = j <= i ? '★' : '☆'; x.style.color = j <= i ? '#f59e0b' : '#d1d5db' }))
    s.addEventListener('mouseleave', () => setReviewStars(_reviewStarRating))
  })
}

async function submitReview() {
  const msg = document.getElementById('reviewFormMsg')
  if (!_reviewProductId) return
  const name    = document.getElementById('reviewName')?.value.trim()
  const email   = document.getElementById('reviewEmail')?.value.trim()
  const comment = document.getElementById('reviewComment')?.value.trim()
  if (!name || !email || !_reviewStarRating) {
    if (msg) { msg.style.display = ''; msg.style.color = '#991b1b'; msg.textContent = 'Please fill in your name, email, and rating.' }
    return
  }
  try {
    const res  = await fetch(`/api/reviews/${_reviewProductId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ customerName: name, customerEmail: email, rating: _reviewStarRating, comment }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error)
    if (msg) { msg.style.display = ''; msg.style.color = '#065f46'; msg.textContent = json.message }
    document.getElementById('reviewName').value    = ''
    document.getElementById('reviewEmail').value   = ''
    document.getElementById('reviewComment').value = ''
    setReviewStars(0)
  } catch (err) {
    if (msg) { msg.style.display = ''; msg.style.color = '#991b1b'; msg.textContent = err.message }
  }
}

// ── Admin nav link ────────────────────────────────────────────────────────────
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
  } catch { /* no-op */ }
}

// ── Site status ───────────────────────────────────────────────────────────────
let _shopOpen = true

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

// ── Cookie Consent ────────────────────────────────────────────────────────────
function initCookieConsent(gaId) {
  if (localStorage.getItem('sns_consent') === 'accepted') {
    loadAnalytics(gaId)
    return
  }
  if (localStorage.getItem('sns_consent') === 'declined') return

  const bar = document.createElement('div')
  bar.className = 'sns-cookie-bar'
  bar.innerHTML = `
    <span class="sns-cookie-bar__text">We use cookies to improve your experience and for analytics. <a href="/privacy" class="sns-cookie-bar__link">Privacy Policy</a></span>
    <div class="sns-cookie-bar__actions">
      <button class="sns-cookie-bar__btn sns-cookie-bar__btn--decline" id="cookieDecline">Decline</button>
      <button class="sns-cookie-bar__btn sns-cookie-bar__btn--accept" id="cookieAccept">Accept</button>
    </div>`
  document.body.appendChild(bar)

  setTimeout(() => bar.classList.add('show'), 100)

  document.getElementById('cookieAccept')?.addEventListener('click', () => {
    localStorage.setItem('sns_consent', 'accepted')
    bar.classList.remove('show')
    setTimeout(() => bar.remove(), 400)
    loadAnalytics(gaId)
  })
  document.getElementById('cookieDecline')?.addEventListener('click', () => {
    localStorage.setItem('sns_consent', 'declined')
    bar.classList.remove('show')
    setTimeout(() => bar.remove(), 400)
  })
}

function loadAnalytics(gaId) {
  if (!gaId || document.getElementById('ga-script')) return
  const script = document.createElement('script')
  script.id    = 'ga-script'
  script.src   = `https://www.googletagmanager.com/gtag/js?id=${gaId}`
  script.async = true
  document.head.appendChild(script)
  const inline = document.createElement('script')
  inline.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${gaId}')`
  document.head.appendChild(inline)
}

// ── Init on DOM ready ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initVersionTag(document.getElementById('versionTag'))
  initCartDrawer()
  initOrderModal()
  initAdminLink()
  initAnnouncement()
})
