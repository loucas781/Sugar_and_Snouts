/* Sugar & Snouts — Shop page */
'use strict'

let _allProducts    = []
let _activeCategory = ''
let _activeTag      = ''
let _shopSettings   = {}

function productCardHTML(p) {
  const displayPrice = p.offerPrice ?? p.price
  const priceHTML = p.offerPrice
    ? `<span class="offer">£${p.offerPrice.toFixed(2)}</span><span class="original">£${p.price.toFixed(2)}</span>`
    : `£${p.price.toFixed(2)}`

  const tags = [
    p.isFeatured    ? `<span class="tag tag-featured">Favourite</span>` : '',
    p.isNew         ? `<span class="tag tag-new">New</span>` : '',
    p.isRecommended ? `<span class="tag tag-recommended">Recommended</span>` : '',
    p.offerPrice    ? `<span class="tag tag-offer">On Offer</span>` : '',
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
        ${img}
        <div class="product-card__body">
          ${tags ? `<div class="product-tags">${tags}</div>` : ''}
          <div class="product-card__name">${p.name}</div>
          ${p.description ? `<div class="product-card__desc">${p.description}</div>` : ''}
          ${limit}
          ${detailHint}
          <div class="product-card__footer">
            <div class="product-card__price">${priceHTML}</div>
            <button class="product-card__add" data-product='${safeProduct}'>Add to Cart</button>
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

// ── Product Detail Modal ──────────────────────────────────────────────────────

let _detailProduct = null

function openProductDetail(p) {
  _detailProduct = p

  document.getElementById('pdName').textContent = p.name

  // Image
  const imgWrap = document.getElementById('pdImageWrap')
  const img     = document.getElementById('pdImage')
  if (p.imagePath) {
    img.src = p.imagePath
    img.alt = p.name
    imgWrap.style.display = ''
  } else {
    imgWrap.style.display = 'none'
  }

  // Category
  const catEl = document.getElementById('pdCategory')
  catEl.textContent = p.categoryName || p.category || ''

  // Price
  const priceEl = document.getElementById('pdPrice')
  if (p.offerPrice) {
    priceEl.innerHTML = `<span class="offer">£${p.offerPrice.toFixed(2)}</span> <span class="original">£${p.price.toFixed(2)}</span>`
  } else {
    priceEl.textContent = `£${p.price.toFixed(2)}`
  }

  // Description
  const descEl = document.getElementById('pdDescription')
  if (p.description) {
    descEl.textContent = p.description
    descEl.style.display = ''
  } else {
    descEl.style.display = 'none'
  }

  // Ingredients
  const ingEl = document.getElementById('pdIngredients')
  if (p.ingredients) {
    document.getElementById('pdIngredientsText').textContent = p.ingredients
    ingEl.style.display = ''
  } else {
    ingEl.style.display = 'none'
  }

  // Allergen
  const allergenEl = document.getElementById('pdAllergen')
  if (p.allergenInfo) {
    document.getElementById('pdAllergenText').textContent = p.allergenInfo
    allergenEl.style.display = ''
  } else {
    allergenEl.style.display = 'none'
  }

  // Quantity limit
  const limitEl = document.getElementById('pdLimit')
  if (p.quantityLimit) {
    limitEl.textContent = `Max ${p.quantityLimit} per order`
    limitEl.style.display = ''
  } else {
    limitEl.style.display = 'none'
  }

  document.getElementById('productDetailOverlay').classList.add('open')
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
    if (_detailProduct) {
      Cart.add(_detailProduct)
      closeProductDetail()
    }
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
  if (_activeTag === 'featured')    filtered = filtered.filter(p => p.isFeatured)
  if (_activeTag === 'new')         filtered = filtered.filter(p => p.isNew)
  if (_activeTag === 'recommended') filtered = filtered.filter(p => p.isRecommended)

  spinner.style.display = 'none'
  grid.style.display = ''

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

  // Add to cart buttons (stop propagation so card click doesn't also fire)
  grid.querySelectorAll('.product-card__add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const p = JSON.parse(btn.dataset.product)
      Cart.add(p)
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

// ── Shop settings (allergen notice, order form info, delivery, payment) ───────

async function loadShopSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    _shopSettings = s

    // Allergen notice banner
    if (s.allergen_notice) {
      const banner = document.getElementById('allergenNoticeBanner')
      const text   = document.getElementById('allergenNoticeText')
      if (banner && text) {
        text.textContent = s.allergen_notice
        banner.style.display = ''
      }
    }

    // Order form intro
    if (s.order_form_intro) {
      const introEl = document.getElementById('orderFormIntro')
      if (introEl) {
        introEl.textContent = s.order_form_intro
        introEl.style.display = ''
      }
    }

    // Delivery info
    if (s.delivery_enabled === '1') {
      const deliveryEl = document.getElementById('deliveryInfo')
      if (deliveryEl) {
        const fee = parseFloat(s.delivery_fee || '0')
        deliveryEl.innerHTML = `<strong>🚗 Delivery available</strong> — ${fee > 0 ? `£${fee.toFixed(2)} delivery fee` : 'Free delivery'}`
        deliveryEl.style.display = ''
      }
    }

    // Payment methods
    if (s.payment_methods) {
      const pmEl = document.getElementById('paymentMethodsInfo')
      if (pmEl) {
        pmEl.innerHTML = `<strong>💳 Accepted payment methods:</strong> ${s.payment_methods}`
        pmEl.style.display = ''
      }
    }
  } catch { /* no-op */ }
}

document.addEventListener('DOMContentLoaded', async () => {
  initProductDetailModal()
  await loadCategoryFilters()
  loadProducts()
  initTagFilters()
  loadShopSettings()
})
