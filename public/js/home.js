/* Sugar & Snouts — Homepage dynamic sections */
'use strict'

function productCardHTML(p) {
  const price = p.offerPrice
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
    : `<div class="product-card__img-placeholder">🧁</div>`

  const limit = p.quantityLimit ? `<div class="limit-badge">Max ${p.quantityLimit} per order</div>` : ''

  return `
    <div class="col-sm-6 col-lg-3">
      <div class="product-card" data-id="${p.id}">
        ${img}
        <div class="product-card__body">
          ${tags ? `<div class="product-tags">${tags}</div>` : ''}
          <div class="product-card__name">${p.name}</div>
          ${p.description ? `<div class="product-card__desc">${p.description}</div>` : ''}
          ${limit}
          <div class="product-card__footer">
            <div class="product-card__price">${price}</div>
            <button class="product-card__add" data-product='${JSON.stringify(p).replace(/'/g, "&#39;")}'>Add to Cart</button>
          </div>
        </div>
      </div>
    </div>`
}

function attachAddToCart(grid) {
  grid.querySelectorAll('.product-card__add').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = JSON.parse(btn.dataset.product)
      Cart.add(p)
    })
  })
}

async function loadSection(endpoint, gridId, sectionId) {
  try {
    const products = await fetch(endpoint).then(r => r.json())
    if (!products.length) return
    const section = document.getElementById(sectionId)
    const grid    = document.getElementById(gridId)
    if (!section || !grid) return
    grid.innerHTML = products.slice(0, 4).map(productCardHTML).join('')
    section.style.display = ''
    attachAddToCart(grid)
  } catch { /* no-op */ }
}

async function applySiteImages() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())

    // Hero background
    if (s.img_hero_bg) {
      const heroBg = document.getElementById('heroBg')
      if (heroBg) heroBg.style.backgroundImage = `url('${s.img_hero_bg}')`
    }

    // Hero tagline
    if (s.hero_tagline) {
      const subEl = document.querySelector('.hero-sub-heading')
      if (subEl) subEl.textContent = s.hero_tagline
    }

    // Example images
    const imageMap = {
      img_example_cookies:  'imgExampleCookies',
      img_example_cupcakes: 'imgExampleCupcakes',
      img_example_woof:     'imgExampleWoof',
      img_example_pur:      'imgExamplePur',
    }
    Object.entries(imageMap).forEach(([settingKey, elId]) => {
      if (s[settingKey]) {
        const el = document.getElementById(elId)
        if (el) el.src = s[settingKey]
      }
    })

  } catch { /* no-op */ }
}

document.addEventListener('DOMContentLoaded', () => {
  applySiteImages()
  loadSection('/api/products?featured=1&limit=4',     'featuredGrid',     'featured-section')
  loadSection('/api/products?new=1&limit=4',           'newGrid',          'new-section')
  loadSection('/api/products?recommended=1&limit=4',   'recommendedGrid',  'recommended-section')
})
