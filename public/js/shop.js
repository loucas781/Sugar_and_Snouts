/* Sugar & Snouts — Shop page */
'use strict'

let _allProducts    = []
let _activeCategory = ''
let _activeTag      = ''
let _shopSettings   = {}
let _lowStockThreshold = 5

// ── Wishlist ──────────────────────────────────────────────────────────────────
const Wishlist = {
  _key: 'sns_wishlist',
  get()       { try { return JSON.parse(localStorage.getItem(this._key)) || [] } catch { return [] } },
  has(id)     { return this.get().includes(id) },
  toggle(id) {
    const list = this.get()
    const idx  = list.indexOf(id)
    if (idx > -1) list.splice(idx, 1)
    else          list.push(id)
    localStorage.setItem(this._key, JSON.stringify(list))
    window.dispatchEvent(new Event('wishlistUpdated'))
    return idx === -1 // returns true if added
  }
}

function productCardHTML(p) {
  const displayPrice = p.offerPrice ?? p.price
  const priceHTML = p.offerPrice
    ? `<span class="offer">£${p.offerPrice.toFixed(2)}</span><span class="original">£${p.price.toFixed(2)}</span>`
    : `£${p.price.toFixed(2)}`

  const threshold = p.lowStockThreshold ?? _lowStockThreshold
  const isLowStock = !p.isOutOfStock && p.stockAmount !== null && p.stockAmount > 0 && p.stockAmount <= threshold

  const wishlisted = Wishlist.has(p.id)
  const wishlistBtn = `<button class="product-card__wishlist${wishlisted ? ' wishlisted' : ''}" data-wishlist="${p.id}" title="${wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}" aria-label="Wishlist">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="${wishlisted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
  </button>`

  const ageTag = p.isAgeRestricted ? `<span class="tag tag-age">18+</span>` : ''
  const tags = [
    ageTag,
    p.isFeatured    ? `<span class="tag tag-featured">Favourite</span>` : '',
    p.isNew         ? `<span class="tag tag-new">New</span>` : '',
    p.isRecommended ? `<span class="tag tag-recommended">Recommended</span>` : '',
    p.offerPrice    ? `<span class="tag tag-offer">On Offer</span>` : '',
    p.isLimitedTime ? `<span class="tag tag-limited">Limited Time Only</span>` : '',
    isLowStock      ? `<span class="tag tag-lowstock">Low Stock</span>` : '',
    p.isOutOfStock  ? `<span class="tag tag-outofstock">Out of Stock</span>` : '',
  ].filter(Boolean).join('')

  const emoji = getCategoryEmoji(p.category)
  const img = p.imagePath
    ? `<img src="${p.imagePath}" class="product-card__img" alt="${p.name}" loading="lazy" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<div class=\\'product-card__img-placeholder\\'>${emoji}</div>')">`
    : `<div class="product-card__img-placeholder">${emoji}</div>`

  const limit = p.quantityLimit
    ? `<div class="limit-badge">Max ${p.quantityLimit} per order</div>`
    : ''

  const hasDetail = p.allergenInfo || p.ingredients
  const detailHint = hasDetail ? `<div class="pd-detail-hint">Tap for details</div>` : ''

  const safeProduct = JSON.stringify(p).replace(/'/g, "&#39;")
  return `
    <div class="col-sm-6 col-lg-3 product-item" data-category="${p.category}">
      <div class="product-card product-card--clickable" data-product='${safeProduct}'>
        <div class="product-card__img-wrap">
          ${img}
          ${wishlistBtn}
        </div>
        <div class="product-card__body">
          ${tags ? `<div class="product-tags">${tags}</div>` : ''}
          <div class="product-card__name">${p.name}</div>
          ${p.description ? `<div class="product-card__desc">${p.description}</div>` : ''}
          ${limit}
          ${detailHint}
          <div class="product-card__footer">
            <div class="product-card__price">${priceHTML}</div>
            <button class="product-card__add" data-product='${safeProduct}'${p.isOutOfStock ? ' disabled' : ''}>Add to Cart</button>
          </div>
        </div>
      </div>
    </div>`
}

function getCategoryEmoji(cat) {
  const map = { cookies: '🍪', cupcakes: '🧁', woof_treats: '🐾', pur_treats: '🐱' }
  return map[cat] || '🍰'
}

const CATEGORY_EMOJI = { cookies: '🍪', cupcakes: '🧁', woof_treats: '🐾', pur_treats: '🐱' }

// ── Age Gate ──────────────────────────────────────────────────────────────────
function checkAgeGate(product, onConfirm) {
  if (!product.isAgeRestricted) { onConfirm(); return }
  if (sessionStorage.getItem('sns_age_verified') === '1') { onConfirm(); return }

  const overlay = document.getElementById('ageGateOverlay')
  if (!overlay) { onConfirm(); return }

  const text = _shopSettings.age_gate_text || 'This product is age-restricted. Please confirm you are 18 or over.'
  const msgEl = overlay.querySelector('#ageGateMessage')
  if (msgEl) msgEl.textContent = text

  overlay.classList.add('open')

  const confirmBtn = overlay.querySelector('#ageGateConfirm')
  const denyBtn    = overlay.querySelector('#ageGateDeny')

  const cleanup = () => {
    overlay.classList.remove('open')
    confirmBtn?.removeEventListener('click', handleConfirm)
    denyBtn?.removeEventListener('click', handleDeny)
  }

  const handleConfirm = () => {
    sessionStorage.setItem('sns_age_verified', '1')
    cleanup()
    onConfirm()
  }
  const handleDeny = () => {
    cleanup()
    showToast('You must be 18 or over to purchase this item.', 'error')
  }

  confirmBtn?.addEventListener('click', handleConfirm)
  denyBtn?.addEventListener('click', handleDeny)
}

// ── Product Detail Modal ──────────────────────────────────────────────────────
let _detailProduct = null
let _galleryIndex  = 0

function openProductDetail(p) {
  _detailProduct = p
  _galleryIndex  = 0

  document.getElementById('pdName').textContent = p.name

  // Gallery / primary image
  const galleryWrap = document.getElementById('pdGallery')
  if (galleryWrap) {
    const allImages = []
    if (p.imagePath) allImages.push(p.imagePath)
    if (p.images && p.images.length) allImages.push(...p.images.map(i => i.url))

    if (allImages.length > 1) {
      galleryWrap.innerHTML = `
        <div class="pd-gallery">
          <button class="pd-gallery-nav pd-gallery-prev" aria-label="Previous">&#8249;</button>
          <img id="pdGalleryImg" src="${allImages[0]}" alt="${p.name}" class="pd-gallery-img">
          <button class="pd-gallery-nav pd-gallery-next" aria-label="Next">&#8250;</button>
          <div class="pd-gallery-dots">
            ${allImages.map((_, i) => `<span class="pd-gallery-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`).join('')}
          </div>
        </div>`

      const img  = galleryWrap.querySelector('#pdGalleryImg')
      const dots = galleryWrap.querySelectorAll('.pd-gallery-dot')
      const setSlide = (idx) => {
        _galleryIndex = (idx + allImages.length) % allImages.length
        img.src = allImages[_galleryIndex]
        dots.forEach((d, i) => d.classList.toggle('active', i === _galleryIndex))
      }
      galleryWrap.querySelector('.pd-gallery-prev')?.addEventListener('click', () => setSlide(_galleryIndex - 1))
      galleryWrap.querySelector('.pd-gallery-next')?.addEventListener('click', () => setSlide(_galleryIndex + 1))
      dots.forEach(d => d.addEventListener('click', () => setSlide(parseInt(d.dataset.idx))))
    } else if (allImages.length === 1) {
      galleryWrap.innerHTML = `<img src="${allImages[0]}" alt="${p.name}" class="pd-single-img">`
    } else {
      galleryWrap.innerHTML = `<div class="product-card__img-placeholder" style="height:200px">${getCategoryEmoji(p.category)}</div>`
    }
  }

  // Category
  const catEl = document.getElementById('pdCategory')
  if (catEl) catEl.textContent = p.categoryName || p.category || ''

  // Price
  const priceEl = document.getElementById('pdPrice')
  if (priceEl) {
    if (p.offerPrice) {
      priceEl.innerHTML = `<span class="offer">£${p.offerPrice.toFixed(2)}</span> <span class="original">£${p.price.toFixed(2)}</span>`
    } else {
      priceEl.textContent = `£${p.price.toFixed(2)}`
    }
  }

  // Description
  const descEl = document.getElementById('pdDescription')
  if (descEl) {
    if (p.description) { descEl.textContent = p.description; descEl.style.display = '' }
    else descEl.style.display = 'none'
  }

  // Ingredients
  const ingEl = document.getElementById('pdIngredients')
  if (ingEl) {
    if (p.ingredients) { document.getElementById('pdIngredientsText').textContent = p.ingredients; ingEl.style.display = '' }
    else ingEl.style.display = 'none'
  }

  // Allergen
  const allergenEl = document.getElementById('pdAllergen')
  if (allergenEl) {
    if (p.allergenInfo) { document.getElementById('pdAllergenText').textContent = p.allergenInfo; allergenEl.style.display = '' }
    else allergenEl.style.display = 'none'
  }

  // Quantity limit
  const limitEl = document.getElementById('pdLimit')
  if (limitEl) {
    if (p.quantityLimit) { limitEl.textContent = `Max ${p.quantityLimit} per order`; limitEl.style.display = '' }
    else limitEl.style.display = 'none'
  }

  // Low stock indicator
  const threshold = p.lowStockThreshold ?? _lowStockThreshold
  const isLowStock = !p.isOutOfStock && p.stockAmount !== null && p.stockAmount > 0 && p.stockAmount <= threshold
  const lowStockEl = document.getElementById('pdLowStock')
  if (lowStockEl) {
    if (isLowStock) { lowStockEl.textContent = `Only ${p.stockAmount} left!`; lowStockEl.style.display = '' }
    else lowStockEl.style.display = 'none'
  }

  // Age restriction notice
  const ageEl = document.getElementById('pdAgeNotice')
  if (ageEl) {
    ageEl.style.display = p.isAgeRestricted ? '' : 'none'
  }

  const addBtn = document.getElementById('productDetailAddBtn')
  if (addBtn) {
    if (p.isOutOfStock) { addBtn.disabled = true; addBtn.textContent = 'Sold Out' }
    else { addBtn.disabled = false; addBtn.textContent = 'Add to Cart' }
  }

  document.getElementById('productDetailOverlay').classList.add('open')

  // Load reviews if function is available
  if (typeof loadProductReviews === 'function') {
    const form = document.getElementById('pdReviewForm')
    if (form) form.style.display = 'none'
    loadProductReviews(p.id)
  }
}

function closeProductDetail() {
  document.getElementById('productDetailOverlay').classList.remove('open')
  _detailProduct = null
}

function initProductDetailModal() {
  document.getElementById('productDetailClose')?.addEventListener('click', closeProductDetail)
  document.getElementById('productDetailCancel')?.addEventListener('click', closeProductDetail)
  document.getElementById('productDetailOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'productDetailOverlay') closeProductDetail()
  })
  document.getElementById('productDetailAddBtn')?.addEventListener('click', () => {
    if (!_detailProduct || _detailProduct.isOutOfStock) return
    checkAgeGate(_detailProduct, () => {
      Cart.add(_detailProduct)
      closeProductDetail()
    })
  })
}

// ── Category filters ──────────────────────────────────────────────────────────
async function loadCategoryFilters() {
  try {
    const categories = await fetch('/api/products/categories').then(r => r.json())
    const container  = document.getElementById('categoryFilter')
    if (!container) return

    container.innerHTML = '<button class="category-btn active" data-cat="">All</button>'
    categories.forEach(cat => {
      const emoji  = CATEGORY_EMOJI[cat.id] ? `${CATEGORY_EMOJI[cat.id]} ` : ''
      const btn    = document.createElement('button')
      btn.className    = 'category-btn'
      btn.dataset.cat  = cat.id
      btn.textContent  = `${emoji}${cat.name}`
      container.appendChild(btn)
    })

    attachCategoryListeners()
  } catch { /* no-op */ }
}

function renderProducts() {
  const grid    = document.getElementById('shopGrid')
  const spinner = document.getElementById('shopSpinner')
  if (!grid) return

  let filtered = _allProducts
  if (_activeCategory) filtered = filtered.filter(p => p.category === _activeCategory)
  if (_activeTag === 'wishlist')    filtered = filtered.filter(p => Wishlist.has(p.id))
  if (_activeTag === 'new')         filtered = filtered.filter(p => p.isNew)
  if (_activeTag === 'recommended') filtered = filtered.filter(p => p.isRecommended)

  spinner.style.display = 'none'
  grid.style.display = ''

  if (_activeTag === 'wishlist' && filtered.length === 0) {
    grid.innerHTML = `
      <div class="shop-empty">
        <div class="shop-empty-icon">🤍</div>
        <h3>Your wishlist is empty</h3>
        <p>Tap the heart icon on any product to save it here.</p>
      </div>`
    return
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="shop-empty">
        <div class="shop-empty-icon">🍰</div>
        <h3>Nothing here yet!</h3>
        <p>Check back soon — we're baking something delicious.</p>
      </div>`
    return
  }

  grid.innerHTML = filtered.map(productCardHTML).join('')

  // Wishlist buttons
  grid.querySelectorAll('[data-wishlist]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.dataset.wishlist
      const added = Wishlist.toggle(id)
      btn.classList.toggle('wishlisted', added)
      btn.querySelector('svg')?.setAttribute('fill', added ? 'currentColor' : 'none')
      btn.title = added ? 'Remove from wishlist' : 'Save to wishlist'
      showToast(added ? 'Saved to wishlist!' : 'Removed from wishlist')
      if (_activeTag === 'wishlist') renderProducts()
    })
  })

  // Add to cart buttons
  grid.querySelectorAll('.product-card__add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const p = JSON.parse(btn.dataset.product)
      checkAgeGate(p, () => Cart.add(p))
    })
  })

  // Card click — open product detail modal
  grid.querySelectorAll('.product-card--clickable').forEach(card => {
    card.addEventListener('click', () => {
      const p = JSON.parse(card.dataset.product)
      openProductDetail(p)
    })
  })
}

async function loadProducts() {
  try {
    _allProducts = await fetch('/api/products').then(r => r.json())
    renderProducts()
  } catch (err) {
    console.error('Failed to load products:', err)
    document.getElementById('shopSpinner').style.display = 'none'
    document.getElementById('shopGrid').innerHTML = `
      <div class="shop-empty">
        <div class="shop-empty-icon">⚠️</div>
        <p>Failed to load products. Please try again.</p>
      </div>`
    document.getElementById('shopGrid').style.display = ''
  }
}

function attachCategoryListeners() {
  document.querySelectorAll('#categoryFilter .category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#categoryFilter .category-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      _activeCategory = btn.dataset.cat || ''
      renderProducts()
    })
  })
}

function initTagFilters() {
  document.querySelectorAll('#tagFilter .category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag
      if (_activeTag === tag) {
        _activeTag = ''
        btn.classList.remove('active')
      } else {
        document.querySelectorAll('#tagFilter .category-btn').forEach(b => b.classList.remove('active'))
        _activeTag = tag
        btn.classList.add('active')
      }
      renderProducts()
    })
  })
}

// ── Shop settings ─────────────────────────────────────────────────────────────
async function loadShopSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    _shopSettings = s

    if (s.low_stock_threshold) {
      const t = parseInt(s.low_stock_threshold)
      if (t > 0) _lowStockThreshold = t
    }

    if (s.allergen_notice) {
      const banner = document.getElementById('allergenNoticeBanner')
      const text   = document.getElementById('allergenNoticeText')
      if (banner && text) {
        text.textContent = s.allergen_notice
        banner.style.display = ''
      }
    }

    if (s.order_form_intro) {
      const introEl = document.getElementById('orderFormIntro')
      if (introEl) {
        introEl.textContent = s.order_form_intro
        introEl.style.display = ''
      }
    }

    if (s.delivery_enabled === '1') {
      const deliveryEl = document.getElementById('deliveryInfo')
      if (deliveryEl) {
        const fee = parseFloat(s.delivery_fee || '0')
        deliveryEl.innerHTML = `<strong>🚗 Delivery available</strong> — ${fee > 0 ? `£${fee.toFixed(2)} delivery fee` : 'Free delivery'}`
        deliveryEl.style.display = ''
      }
    }

    if (s.payment_methods) {
      const pmEl = document.getElementById('paymentMethodsInfo')
      if (pmEl) {
        pmEl.innerHTML = `<strong>💳 Accepted payment methods:</strong> ${s.payment_methods}`
        pmEl.style.display = ''
      }
    }
  } catch { /* no-op */ }
}

// Update wishlist hearts when wishlist changes (e.g. after toggle in another view)
window.addEventListener('wishlistUpdated', () => {
  document.querySelectorAll('[data-wishlist]').forEach(btn => {
    const id = btn.dataset.wishlist
    const wishlisted = Wishlist.has(id)
    btn.classList.toggle('wishlisted', wishlisted)
    btn.querySelector('svg')?.setAttribute('fill', wishlisted ? 'currentColor' : 'none')
    btn.title = wishlisted ? 'Remove from wishlist' : 'Save to wishlist'
  })
})

document.addEventListener('DOMContentLoaded', async () => {
  initProductDetailModal()
  await loadCategoryFilters()
  loadProducts()
  initTagFilters()
  loadShopSettings()
})
