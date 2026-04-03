/* Sugar & Snouts — Shop page */
'use strict'

let _allProducts = []
let _activeCategory = ''
let _activeTag = ''

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

  const img = p.imagePath
    ? `<img src="${p.imagePath}" class="product-card__img" alt="${p.name}" loading="lazy">`
    : `<div class="product-card__img-placeholder">${getCategoryEmoji(p.category)}</div>`

  const limit = p.quantityLimit
    ? `<div class="limit-badge">Max ${p.quantityLimit} per order</div>`
    : ''

  const safeProduct = JSON.stringify(p).replace(/'/g, "&#39;")
  return `
    <div class="col-sm-6 col-lg-3 product-item" data-category="${p.category}">
      <div class="product-card">
        ${img}
        <div class="product-card__body">
          ${tags ? `<div class="product-tags">${tags}</div>` : ''}
          <div class="product-card__name">${p.name}</div>
          ${p.description ? `<div class="product-card__desc">${p.description}</div>` : ''}
          ${limit}
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

  grid.querySelectorAll('.product-card__add').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = JSON.parse(btn.dataset.product)
      Cart.add(p)
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

function initFilters() {
  document.querySelectorAll('#categoryFilter .category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#categoryFilter .category-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      _activeCategory = btn.dataset.cat || ''
      renderProducts()
    })
  })

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

document.addEventListener('DOMContentLoaded', () => {
  loadProducts()
  initFilters()
})
