/* Sugar & Snouts — Admin Dashboard */
'use strict'

let _editingProductId = null
let _editingOrderId   = null
let _editingUserId    = null
let _openMsgId        = null
let _newImageFile     = null
let _cropper          = null
let _productFilter    = ''
let _allProducts      = []
let _categories       = []
let _currentUser      = null

// ── Auth guard ────────────────────────────────────────────────────────────────
async function initAdmin() {
  try {
    const res = await fetch('/api/config')
    const cfg = await res.json()
    if (!cfg.user) { window.location.href = '/admin/'; return }
    _currentUser = cfg.user

    // Version tag (sidebar footer)
    const v   = cfg.version || '0.0.1'
    const env = cfg.appEnv  || 'development'
    const isDev = v.includes('-dev.'), isRC = v.includes('-rc')
    const base   = v.split('-')[0]
    const devNum = isDev ? v.split('-dev.')[1] : null
    const tag    = isDev ? `v${base}-dev.${devNum}` : isRC ? `v${base}-rc` : `v${base}`
    const cls    = isDev ? 'badge-dev' : isRC ? 'badge-rc' : 'badge-prod'
    const vEl = document.getElementById('versionTag')
    if (vEl) vEl.innerHTML = `<span class="version-tag ${cls}">${env}</span> ${tag}`

    // Topbar user
    const nameEl = document.getElementById('userName')
    const initEl = document.getElementById('userInitials')
    if (nameEl) { nameEl.textContent = cfg.user.name; nameEl.style.display = '' }
    if (initEl) initEl.textContent = (cfg.user.name || 'A').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()

    // Badges
    if (cfg.unreadMessages > 0) {
      const b = document.getElementById('unreadBadge')
      if (b) { b.textContent = cfg.unreadMessages; b.style.display = '' }
    }
    if (cfg.pendingOrders > 0) {
      const b = document.getElementById('pendingBadge')
      if (b) { b.textContent = cfg.pendingOrders; b.style.display = '' }
    }

    // Show Users nav for admins only
    if (cfg.user.role === 'admin') {
      const navUsers = document.getElementById('navUsers')
      if (navUsers) navUsers.style.display = ''
    }

    loadStats()
    setupTabs()
    loadCategories().then(setupProductFilters)
    setupSidebar()
    startPolling()
  } catch { window.location.href = '/admin/' }
}

// ── Live polling ──────────────────────────────────────────────────────────────
let _pollTimer = null

function startPolling() {
  if (_pollTimer) return
  _pollTimer = setInterval(pollForUpdates, 30000)
}

async function pollForUpdates() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    if (!cfg.user) return // session ended

    const unreadBadge  = document.getElementById('unreadBadge')
    const pendingBadge = document.getElementById('pendingBadge')
    if (unreadBadge) {
      unreadBadge.textContent  = cfg.unreadMessages
      unreadBadge.style.display = cfg.unreadMessages > 0 ? '' : 'none'
    }
    if (pendingBadge) {
      pendingBadge.textContent  = cfg.pendingOrders
      pendingBadge.style.display = cfg.pendingOrders > 0 ? '' : 'none'
    }

    // Refresh whichever tab is currently open
    const activeTab = document.querySelector('.admin-nav-item.active')?.dataset.tab
    if (activeTab === 'messages') loadMessages()
    if (activeTab === 'orders')   loadOrders()
    if (activeTab === 'overview') loadStats()
  } catch { /* no-op */ }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'))
  const pane = document.getElementById(`tab-${name}`)
  const btn  = document.querySelector(`[data-tab="${name}"]`)
  if (pane) pane.classList.add('active')
  if (btn)  btn.classList.add('active')
  const titles = { overview: 'Overview', products: 'Products', orders: 'Orders', messages: 'Messages', users: 'Users', settings: 'Settings' }
  const titleEl = document.getElementById('topbarTitle')
  if (titleEl) titleEl.textContent = titles[name] || name

  if (name === 'products') loadProducts()
  if (name === 'orders')   loadOrders()
  if (name === 'messages') loadMessages()
  if (name === 'users')    loadUsers()
  if (name === 'settings') {
    // Load the currently active settings sub-tab's data
    const active = document.querySelector('#tab-settings [data-stab].active')
    const stab = active?.dataset.stab || 'general'
    loadSettingsSubTab(stab)
  }
  closeSidebar()
}

// ── Settings sub-tabs ─────────────────────────────────────────────────────────
function switchSettingsTab(name) {
  document.querySelectorAll('#tab-settings .settings-sub-pane').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('#tab-settings [data-stab]').forEach(b => b.classList.remove('active'))
  const pane = document.getElementById(`stab-${name}`)
  const btn  = document.querySelector(`[data-stab="${name}"]`)
  if (pane) pane.classList.add('active')
  if (btn)  btn.classList.add('active')
  loadSettingsSubTab(name)
}

function loadSettingsSubTab(name) {
  if (name === 'general')  { loadSiteSettings(); loadSiteIdentity(); loadMaintenanceSettings() }
  if (name === 'images')   loadSiteImages()
  if (name === 'homepage') { loadHomeExamples(); loadHomepageToggles() }
  if (name === 'shop')     { loadCategories(); loadOrderSettings(); loadShopContent(); loadDeliverySettings() }
  if (name === 'contact')  { loadContactSettings(); loadEmailNotifSettings(); loadSmtpSettings() }
  if (name === 'hours')    loadHoursSettings()
  if (name === 'seo')      { loadSeoSettings(); loadAnalyticsSettings() }
  if (name === 'system')   loadBuildInfo()
  // account tab has no async data to load
}

function setupTabs() {
  document.querySelectorAll('.admin-nav-item[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)))
}

// ── Sidebar toggle (mobile) ───────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('adminSidebar')
  const overlay  = document.getElementById('sidebarOverlay')
  const isOpen   = sidebar.classList.toggle('open')
  overlay.style.display = isOpen ? 'block' : 'none'
}
function closeSidebar() {
  document.getElementById('adminSidebar')?.classList.remove('open')
  const ov = document.getElementById('sidebarOverlay')
  if (ov) ov.style.display = 'none'
}
function setupSidebar() {
  document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar)
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/admin/'
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await fetch('/api/stats').then(r => r.json())
    document.getElementById('statProducts').textContent  = s.totalProducts
    document.getElementById('statAvailable').textContent = s.availableProducts
    document.getElementById('statFeatured').textContent  = s.featuredProducts
    document.getElementById('statOrders').textContent    = s.totalOrders
    document.getElementById('statPending').textContent   = s.pendingOrders
    document.getElementById('statMessages').textContent  = s.unreadMessages
  } catch { /* no-op */ }
}

// ── Build Info ────────────────────────────────────────────────────────────────
async function loadBuildInfo() {
  const el = document.getElementById('buildInfo')
  if (!el) return
  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    const v = cfg.version || '?'
    const env = cfg.appEnv || '?'
    const isDev = v.includes('-dev.'), isRC = v.includes('-rc')
    const cls = isDev ? 'badge-dev' : isRC ? 'badge-rc' : 'badge-prod'
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem;align-items:center">
        <span style="color:#9ca3af;font-size:.8rem">Version</span>
        <strong style="font-family:monospace">${v}</strong>
        <span style="color:#9ca3af;font-size:.8rem">Environment</span>
        <span class="version-tag ${cls}" style="font-family:system-ui">${env}</span>
        <span style="color:#9ca3af;font-size:.8rem">App Name</span>
        <span>${cfg.appName}</span>
      </div>`
  } catch { el.textContent = 'Could not load info' }
}

// ── Categories ────────────────────────────────────────────────────────────────
async function loadCategories() {
  try {
    _categories = await fetch('/api/products/categories').then(r => r.json())
    renderCategoriesList()
    populateCategorySelect()
  } catch { /* no-op */ }
}

function renderCategoriesList() {
  const el = document.getElementById('categoriesList')
  if (!el) return
  if (!_categories.length) {
    el.innerHTML = '<p style="color:#9ca3af;font-size:.85rem">No categories yet.</p>'
    return
  }
  el.innerHTML = _categories.map(c => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .75rem;background:#f9fafb;border-radius:8px;margin-bottom:.4rem">
      <span style="font-size:.9rem">${c.name}</span>
      <button class="btn-admin-sm btn-delete" onclick="deleteCategory('${c.id}','${c.name.replace(/'/g,"&#39;")}')" style="padding:.2rem .5rem;font-size:.75rem">🗑️</button>
    </div>`).join('')
}

function populateCategorySelect() {
  const sel = document.getElementById('pCategoryId')
  if (!sel) return
  const current = sel.value
  sel.innerHTML = _categories.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('') || '<option value="">No categories</option>'
  if (current && _categories.find(c => c.id === current)) sel.value = current
}

async function addCategory() {
  const input = document.getElementById('newCategoryName')
  const alert = document.getElementById('catAlert')
  const name  = input?.value.trim()
  if (!name) return

  try {
    const res  = await fetch('/api/products/admin/categories', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name })
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed to add category')
    input.value = ''
    alert.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.6rem 1rem;font-size:.85rem'
    alert.textContent   = `✓ Category "${name}" added`
    await loadCategories()
    setupProductFilters()
  } catch (err) {
    alert.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.6rem 1rem;font-size:.85rem'
    alert.textContent   = '✗ ' + err.message
  }
}

async function deleteCategory(id, name) {
  if (!confirm(`Delete category "${name}"? Products in this category will become uncategorised.`)) return
  const alert = document.getElementById('catAlert')
  try {
    const res  = await fetch(`/api/products/admin/categories/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Delete failed')
    alert.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.6rem 1rem;font-size:.85rem'
    alert.textContent   = `✓ Category deleted`
    await loadCategories()
    setupProductFilters()
  } catch (err) {
    alert.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.6rem 1rem;font-size:.85rem'
    alert.textContent   = '✗ ' + err.message
  }
}

// ── Products ──────────────────────────────────────────────────────────────────
async function loadProducts() {
  const spinner = document.getElementById('productsSpinner')
  const grid    = document.getElementById('productGrid')
  const empty   = document.getElementById('productEmpty')
  spinner.style.display = ''
  grid.style.display    = 'none'
  empty.style.display   = 'none'

  try {
    _allProducts = await fetch('/api/products/admin/all').then(r => r.json())
    renderProductGrid()
  } catch {
    spinner.style.display = 'none'
    empty.style.display   = ''
    empty.querySelector('p').textContent = 'Failed to load products.'
  }
}

function renderProductGrid() {
  const spinner = document.getElementById('productsSpinner')
  const grid    = document.getElementById('productGrid')
  const empty   = document.getElementById('productEmpty')
  spinner.style.display = 'none'

  const filtered = _productFilter
    ? _allProducts.filter(p => p.category === _productFilter)
    : _allProducts

  if (!filtered.length) {
    grid.style.display  = 'none'
    empty.style.display = ''
    return
  }

  empty.style.display = 'none'
  grid.style.display  = ''
  grid.innerHTML = filtered.map(productCardHTML).join('')

  grid.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openEditProduct(btn.dataset.edit)))
  grid.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteProduct(btn.dataset.delete, btn.dataset.name)))
}

function setupProductFilters() {
  const bar = document.getElementById('productTabFilter')
  if (!bar) return

  bar.innerHTML = `<button class="admin-tab active" data-pcat="">All</button>` +
    _categories.map(c =>
      `<button class="admin-tab" data-pcat="${c.id}">${c.name}</button>`
    ).join('')

  bar.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      bar.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      _productFilter = tab.dataset.pcat || ''
      renderProductGrid()
    })
  })
}

function productCardHTML(p) {
  const priceText = p.offerPrice
    ? `<span style="color:var(--pink-dark)">£${p.offerPrice.toFixed(2)}</span> <span style="text-decoration:line-through;color:#9ca3af;font-size:.85rem">£${p.price.toFixed(2)}</span>`
    : `£${p.price.toFixed(2)}`
  const tags = [
    p.isFeatured    ? `<span class="tag tag-featured">Fav</span>` : '',
    p.isNew         ? `<span class="tag tag-new">New</span>` : '',
    p.isRecommended ? `<span class="tag tag-recommended">Rec</span>` : '',
  ].filter(Boolean).join('')
  const catLabel = p.categoryName || (p.category || '').replace(/_/g, ' ')
  const img = p.imagePath
    ? `<img src="${p.imagePath}" class="admin-product-card__img" alt="${p.name}">`
    : `<div class="admin-product-card__img-placeholder">🍰</div>`

  return `
    <div class="admin-product-card">
      <span class="avail-badge ${p.isAvailable ? 'on' : 'off'}">${p.isAvailable ? 'Active' : 'Hidden'}</span>
      ${img}
      <div class="admin-product-card__body">
        <div class="admin-product-card__name" title="${p.name}">${p.name}</div>
        <div class="admin-product-card__cat">${catLabel}</div>
        <div class="admin-product-card__price">${priceText}</div>
        ${p.quantityLimit ? `<div style="font-size:.75rem;color:#9ca3af;margin-bottom:.4rem">Limit: ${p.quantityLimit}/order</div>` : ''}
        ${tags ? `<div class="admin-product-card__tags">${tags}</div>` : ''}
        <div class="admin-product-card__actions">
          <button class="btn-admin-sm btn-edit" data-edit="${p.id}">✏️ Edit</button>
          <button class="btn-admin-sm btn-delete" data-delete="${p.id}" data-name="${p.name}">🗑️</button>
        </div>
      </div>
    </div>`
}

function openAddProduct() {
  _editingProductId = null
  _newImageFile     = null
  document.getElementById('productModalTitle').textContent = 'Add Product'
  document.getElementById('productForm').reset()
  document.getElementById('pAvailable').checked = true
  populateCategorySelect()
  clearImage()
  openProductModal()
}

function openEditProduct(id) {
  const p = _allProducts.find(x => x.id === id)
  if (!p) return
  _editingProductId = id
  _newImageFile     = null
  document.getElementById('productModalTitle').textContent = 'Edit Product'
  document.getElementById('productId').value      = id
  document.getElementById('pName').value          = p.name
  document.getElementById('pDesc').value          = p.description  || ''
  document.getElementById('pIngredients').value   = p.ingredients  || ''
  document.getElementById('pAllergenInfo').value  = p.allergenInfo || ''
  document.getElementById('pPrice').value         = p.price
  document.getElementById('pOfferPrice').value    = p.offerPrice || ''
  document.getElementById('pOfferExpires').value  = p.offerExpiresAt ? p.offerExpiresAt.replace('Z','').slice(0,16) : ''
  document.getElementById('pQtyLimit').value      = p.quantityLimit || ''
  document.getElementById('pSortOrder').value     = p.sortOrder ?? 0
  document.getElementById('pAvailable').checked   = p.isAvailable
  document.getElementById('pFeatured').checked    = p.isFeatured
  document.getElementById('pNew').checked         = p.isNew
  document.getElementById('pRecommended').checked = p.isRecommended

  populateCategorySelect()
  const catSel = document.getElementById('pCategoryId')
  if (catSel) catSel.value = p.category || ''

  if (p.imagePath) {
    document.getElementById('imgPlaceholder').style.display   = 'none'
    document.getElementById('imgPreviewWrap').style.display   = ''
    document.getElementById('imgPreview').src = p.imagePath
  } else {
    clearImage()
  }
  openProductModal()
}

function openProductModal()  { document.getElementById('productModalOverlay').classList.add('open') }
function closeProductModal() { document.getElementById('productModalOverlay').classList.remove('open') }

// Image handling
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('imageInput')
  input?.addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (file) openCropModal(file)
  })

  const area = document.getElementById('imgUploadArea')
  area?.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover') })
  area?.addEventListener('dragleave', () => area.classList.remove('dragover'))
  area?.addEventListener('drop', (e) => {
    e.preventDefault()
    area.classList.remove('dragover')
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) openCropModal(file)
  })
})

function previewImage(file) {
  _newImageFile = file
  const reader = new FileReader()
  reader.onload = (e) => {
    document.getElementById('imgPlaceholder').style.display   = 'none'
    document.getElementById('imgPreviewWrap').style.display   = ''
    document.getElementById('imgPreview').src = e.target.result
  }
  reader.readAsDataURL(file)
}

function clearImage() {
  _newImageFile = null
  document.getElementById('imgPlaceholder').style.display   = ''
  document.getElementById('imgPreviewWrap').style.display   = 'none'
  document.getElementById('imgPreview').src = ''
  document.getElementById('imageInput').value = ''
}

function openCropModal(file) {
  const url = URL.createObjectURL(file)
  const img  = document.getElementById('cropperImg')
  img.src = url
  document.getElementById('cropModalOverlay').classList.add('open')
  if (_cropper) { _cropper.destroy(); _cropper = null }
  img.onload = () => {
    _cropper = new Cropper(img, {
      aspectRatio:      4 / 3,
      viewMode:         1,
      autoCropArea:     0.9,
      responsive:       true,
      checkOrientation: false,  // sharp handles EXIF rotation server-side
    })
  }
}

function applyCrop() {
  if (!_cropper) return
  _cropper.getCroppedCanvas({ maxWidth: 1920, maxHeight: 1440 }).toBlob(blob => {
    if (!blob) return
    _newImageFile = new File([blob], 'cropped.jpg', { type: 'image/jpeg' })
    const reader = new FileReader()
    reader.onload = e => {
      document.getElementById('imgPreview').src = e.target.result
      document.getElementById('imgPlaceholder').style.display = 'none'
      document.getElementById('imgPreviewWrap').style.display = 'block'
    }
    reader.readAsDataURL(blob)
    closeCropModal()
  }, 'image/jpeg', 0.92)
}

function closeCropModal() {
  document.getElementById('cropModalOverlay').classList.remove('open')
  if (_cropper) { _cropper.destroy(); _cropper = null }
  document.getElementById('imageInput').value = ''
}

async function saveProduct() {
  const btn = document.getElementById('productSaveBtn')
  btn.disabled = true
  btn.textContent = 'Saving…'

  try {
    const categoryId = document.getElementById('pCategoryId').value

    const fd = new FormData()
    fd.append('name',          document.getElementById('pName').value)
    fd.append('description',   document.getElementById('pDesc').value)
    fd.append('ingredients',   document.getElementById('pIngredients').value)
    fd.append('allergenInfo',  document.getElementById('pAllergenInfo').value)
    fd.append('categoryId',    categoryId)
    fd.append('price',         document.getElementById('pPrice').value)
    fd.append('offerPrice',    document.getElementById('pOfferPrice').value)
    fd.append('offerExpiresAt', document.getElementById('pOfferExpires').value)
    fd.append('quantityLimit', document.getElementById('pQtyLimit').value)
    fd.append('sortOrder',     document.getElementById('pSortOrder').value)
    fd.append('isAvailable',   document.getElementById('pAvailable').checked)
    fd.append('isFeatured',    document.getElementById('pFeatured').checked)
    fd.append('isNew',         document.getElementById('pNew').checked)
    fd.append('isRecommended', document.getElementById('pRecommended').checked)
    if (_newImageFile) fd.append('image', _newImageFile)

    let res
    if (_editingProductId) {
      if (_newImageFile) {
        const imgFd = new FormData()
        imgFd.append('image', _newImageFile)
        const imgRes = await fetch(`/api/products/admin/${_editingProductId}/image`, { method: 'POST', body: imgFd })
        if (!imgRes.ok) {
          const imgErr = await imgRes.json().catch(() => ({}))
          throw new Error(imgErr.error || 'Image upload failed')
        }
      }
      res = await fetch(`/api/products/admin/${_editingProductId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          document.getElementById('pName').value,
          description:   document.getElementById('pDesc').value,
          ingredients:   document.getElementById('pIngredients').value,
          allergenInfo:  document.getElementById('pAllergenInfo').value,
          categoryId,
          price:         parseFloat(document.getElementById('pPrice').value),
          offerPrice:    document.getElementById('pOfferPrice').value ? parseFloat(document.getElementById('pOfferPrice').value) : null,
          offerExpiresAt: document.getElementById('pOfferExpires').value || null,
          quantityLimit: document.getElementById('pQtyLimit').value ? parseInt(document.getElementById('pQtyLimit').value) : null,
          sortOrder:     parseInt(document.getElementById('pSortOrder').value) || 0,
          isAvailable:   document.getElementById('pAvailable').checked,
          isFeatured:    document.getElementById('pFeatured').checked,
          isNew:         document.getElementById('pNew').checked,
          isRecommended: document.getElementById('pRecommended').checked,
        })
      })
    } else {
      res = await fetch('/api/products/admin', { method: 'POST', body: fd })
    }

    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')

    closeProductModal()
    loadProducts()
    loadStats()
    showToast(_editingProductId ? 'Product updated!' : 'Product added!', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Save Product'
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
  try {
    const res = await fetch(`/api/products/admin/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Delete failed')
    loadProducts()
    loadStats()
    showToast('Product deleted', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// ── Orders ────────────────────────────────────────────────────────────────────
async function loadOrders() {
  const spinner = document.getElementById('ordersSpinner')
  const wrap    = document.getElementById('ordersTableWrap')
  const empty   = document.getElementById('ordersEmpty')
  const tbody   = document.getElementById('ordersBody')
  const status  = document.getElementById('orderStatusFilter').value

  spinner.style.display = ''
  wrap.style.display    = 'none'
  empty.style.display   = 'none'

  try {
    const url = `/api/orders/admin${status ? '?status=' + status : ''}`
    const { orders } = await fetch(url).then(r => r.json())

    spinner.style.display = 'none'
    if (!orders.length) { empty.style.display = ''; return }

    wrap.style.display = ''
    tbody.innerHTML = orders.map(o => `
      <tr>
        <td style="white-space:nowrap;font-size:.85rem">${new Date(o.created_at).toLocaleDateString('en-GB')}</td>
        <td>
          <div style="font-weight:500">${o.customer_name}</div>
          <div style="font-size:.8rem;color:#9ca3af">${o.customer_email}</div>
        </td>
        <td style="font-size:.85rem">${o.items.length} item${o.items.length !== 1 ? 's' : ''}</td>
        <td style="font-weight:600">£${parseFloat(o.total).toFixed(2)}</td>
        <td><span class="status-badge status-${o.status}">${o.status}</span></td>
        <td><button class="btn-admin-sm btn-edit" onclick="openOrder('${o.id}')">View</button></td>
      </tr>`).join('')
  } catch {
    spinner.style.display = 'none'
    empty.style.display   = ''
    empty.querySelector('p').textContent = 'Failed to load orders.'
  }
}

function openOrder(id) {
  _editingOrderId = id
  document.getElementById('orderModalOverlay').classList.add('open')
  document.getElementById('orderModalBody').innerHTML = '<div class="sns-spinner"></div>'

  fetch(`/api/orders/admin/${id}`)
    .then(r => r.json())
    .then(o => {
      document.getElementById('orderModalBody').innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem;margin-bottom:1.2rem;font-size:.9rem">
          <span style="color:#9ca3af">Customer</span><strong>${o.customer_name}</strong>
          <span style="color:#9ca3af">Email</span><a href="mailto:${o.customer_email}">${o.customer_email}</a>
          ${o.customer_phone ? `<span style="color:#9ca3af">Phone</span><span>${o.customer_phone}</span>` : ''}
          <span style="color:#9ca3af">Date</span><span>${new Date(o.created_at).toLocaleString('en-GB')}</span>
          <span style="color:#9ca3af">Total</span><strong>£${parseFloat(o.total).toFixed(2)}</strong>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:.8rem;margin-bottom:1.2rem">
          ${o.items.map(i => `
            <div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.9rem;border-bottom:1px solid #f9fafb">
              <span>${i.productName} × ${i.quantity}</span>
              <span>£${(i.lineTotal).toFixed(2)}</span>
            </div>`).join('')}
        </div>
        ${o.notes ? `<div style="background:#fffbeb;border-radius:8px;padding:.8rem;margin-bottom:1rem;font-size:.9rem"><strong>Customer notes:</strong> ${o.notes}</div>` : ''}
        <div class="admin-form-group">
          <label class="admin-label">Status</label>
          <select class="admin-select-field" id="orderStatusSelect">
            ${['pending','confirmed','ready','collected','cancelled'].map(s =>
              `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="admin-form-group">
          <label class="admin-label">Admin Notes</label>
          <textarea class="admin-textarea-field" id="orderAdminNotes" style="min-height:70px">${o.admin_notes || ''}</textarea>
        </div>`
    })
}

function closeOrderModal() { document.getElementById('orderModalOverlay').classList.remove('open') }

async function saveOrderStatus() {
  if (!_editingOrderId) return
  const status  = document.getElementById('orderStatusSelect')?.value
  const notes   = document.getElementById('orderAdminNotes')?.value
  try {
    const res = await fetch(`/api/orders/admin/${_editingOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, adminNotes: notes })
    })
    if (!res.ok) throw new Error('Update failed')
    closeOrderModal()
    loadOrders()
    loadStats()
    showToast('Order updated!', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// ── Messages ──────────────────────────────────────────────────────────────────
async function loadMessages() {
  const spinner = document.getElementById('messagesSpinner')
  const list    = document.getElementById('messagesList')
  const empty   = document.getElementById('messagesEmpty')

  spinner.style.display = ''
  list.style.display    = 'none'
  empty.style.display   = 'none'

  try {
    const msgs = await fetch('/api/contact/admin').then(r => r.json())
    spinner.style.display = 'none'

    const unreadEl = document.getElementById('unreadCount')
    if (unreadEl) {
      const unread = msgs.filter(m => !m.is_read).length
      unreadEl.textContent = unread > 0 ? `${unread} unread` : ''
    }

    if (!msgs.length) { empty.style.display = ''; return }

    list.style.display = ''
    list.innerHTML = msgs.map(m => `
      <div class="admin-panel" style="margin-bottom:.8rem;cursor:pointer" onclick="openMsg('${m.id}','${m.name.replace(/'/g,"&#39;")}','${m.email}',\`${m.message.replace(/`/g,'\\`')}\`,${m.is_read ? 'true' : 'false'})">
        <div class="admin-panel__body" style="padding:.9rem 1.2rem">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <strong style="font-size:.95rem">${m.name}</strong>
              ${!m.is_read ? `<span style="background:#fee2e2;color:#991b1b;font-size:.7rem;padding:.15rem .5rem;border-radius:50px;margin-left:.5rem;font-weight:600">Unread</span>` : ''}
              <div style="font-size:.82rem;color:#9ca3af">${m.email}</div>
            </div>
            <div style="font-size:.8rem;color:#9ca3af;white-space:nowrap">${new Date(m.created_at).toLocaleDateString('en-GB')}</div>
          </div>
          <div style="margin-top:.4rem;font-size:.88rem;color:#4b5563;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.message}</div>
        </div>
      </div>`).join('')
  } catch {
    spinner.style.display = 'none'
    empty.style.display   = ''
  }
}

async function openMsg(id, name, email, message, isRead) {
  _openMsgId = id
  const wasUnread = !isRead
  if (wasUnread) {
    await fetch(`/api/contact/admin/${id}/read`, { method: 'PATCH' }).catch(() => {})
  }

  document.getElementById('msgModalBody').innerHTML = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem;margin-bottom:1rem;font-size:.9rem">
      <span style="color:#9ca3af">From</span><strong>${name}</strong>
      <span style="color:#9ca3af">Email</span><a href="mailto:${email}">${email}</a>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:1rem;font-size:.9rem;line-height:1.7;white-space:pre-wrap">${message}</div>`
  document.getElementById('msgModalOverlay').classList.add('open')

  if (wasUnread) {
    loadMessages()
    const badge = document.getElementById('unreadBadge')
    if (badge) {
      const n = Math.max(0, parseInt(badge.textContent) - 1)
      badge.textContent = n
      badge.style.display = n > 0 ? '' : 'none'
    }
  }
}

function closeMsgModal() {
  document.getElementById('msgModalOverlay').classList.remove('open')
  _openMsgId = null
}

async function deleteCurrentMessage() {
  if (!_openMsgId) return
  if (!confirm('Delete this message? This cannot be undone.')) return
  try {
    const res = await fetch(`/api/contact/admin/${_openMsgId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Delete failed')
    closeMsgModal()
    loadMessages()
    loadStats()
    showToast('Message deleted', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const spinner  = document.getElementById('usersSpinner')
  const tableWrap = document.getElementById('usersTableWrap')
  const empty    = document.getElementById('usersEmpty')

  spinner.style.display   = ''
  tableWrap.style.display = 'none'
  empty.style.display     = 'none'

  try {
    const users = await fetch('/api/admin/users').then(r => r.json())
    spinner.style.display = 'none'

    if (!users.length) { empty.style.display = ''; return }

    tableWrap.style.display = ''
    document.getElementById('usersBody').innerHTML = users.map(u => `
      <tr>
        <td style="font-weight:500">${u.name}</td>
        <td style="font-size:.85rem;color:#4b5563">${u.email}</td>
        <td><span class="status-badge status-${u.role === 'admin' ? 'confirmed' : 'pending'}">${u.role}</span></td>
        <td><span class="status-badge status-${u.is_active ? 'confirmed' : 'cancelled'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
        <td style="font-size:.8rem;color:#9ca3af;white-space:nowrap">${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
        <td style="white-space:nowrap">
          <button class="btn-admin-sm btn-edit" onclick="openEditUser('${u.id}')">✏️ Edit</button>
          <button class="btn-admin-sm btn-edit" onclick="openResetPwModal('${u.id}','${u.name.replace(/'/g,"&#39;")}')" style="margin-left:.25rem">🔑</button>
          ${u.id !== _currentUser?.id ? `<button class="btn-admin-sm btn-delete" onclick="deleteUser('${u.id}','${u.name.replace(/'/g,"&#39;")}')">🗑️</button>` : ''}
        </td>
      </tr>`).join('')
  } catch {
    spinner.style.display = 'none'
    empty.style.display   = ''
    document.querySelector('#usersEmpty p').textContent = 'Failed to load users.'
  }
}

function openAddUser() {
  _editingUserId = null
  document.getElementById('userModalTitle').textContent = 'Add User'
  document.getElementById('userForm').reset()
  document.getElementById('userId').value = ''
  document.getElementById('uPasswordGroup').style.display = ''
  document.getElementById('uActiveGroup').style.display   = 'none'
  document.getElementById('userAlert').style.display      = 'none'
  document.getElementById('userModalOverlay').classList.add('open')
}

function openEditUser(id) {
  const row = document.querySelector(`#usersBody tr [onclick="openEditUser('${id}')"]`)
  // Re-fetch user data from the table row
  fetch('/api/admin/users').then(r => r.json()).then(users => {
    const u = users.find(x => x.id === id)
    if (!u) return
    _editingUserId = id
    document.getElementById('userModalTitle').textContent = 'Edit User'
    document.getElementById('userId').value    = id
    document.getElementById('uName').value     = u.name
    document.getElementById('uEmail').value    = u.email
    document.getElementById('uRole').value     = u.role
    document.getElementById('uActive').checked = !!u.is_active
    document.getElementById('uPassword').value = ''
    document.getElementById('uPasswordGroup').style.display = 'none'
    document.getElementById('uActiveGroup').style.display   = ''
    document.getElementById('userAlert').style.display      = 'none'
    document.getElementById('userModalOverlay').classList.add('open')
  })
}

function closeUserModal() {
  document.getElementById('userModalOverlay').classList.remove('open')
  _editingUserId = null
}

async function saveUser() {
  const btn   = document.getElementById('userSaveBtn')
  const alert = document.getElementById('userAlert')
  btn.disabled    = true
  btn.textContent = 'Saving…'
  alert.style.display = 'none'

  const name     = document.getElementById('uName').value.trim()
  const email    = document.getElementById('uEmail').value.trim()
  const password = document.getElementById('uPassword').value
  const role     = document.getElementById('uRole').value
  const isActive = document.getElementById('uActive').checked

  try {
    let res
    if (_editingUserId) {
      const body = { name, email, role, isActive }
      res = await fetch(`/api/admin/users/${_editingUserId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      })
    } else {
      if (!password) throw new Error('Password is required for new users')
      res = await fetch('/api/admin/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password, role })
      })
    }
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    closeUserModal()
    loadUsers()
    showToast(_editingUserId ? 'User updated!' : 'User created!', 'success')
  } catch (err) {
    alert.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    alert.textContent   = '✗ ' + err.message
  } finally {
    btn.disabled    = false
    btn.textContent = 'Save'
  }
}

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return
  try {
    const res  = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Delete failed')
    loadUsers()
    showToast('User deleted', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

let _resetPwUserId = null

function openResetPwModal(userId, userName) {
  _resetPwUserId = userId
  document.getElementById('resetPwInfo').textContent = `Set a new password for ${userName}.`
  document.getElementById('resetPwValue').value = ''
  document.getElementById('resetPwAlert').style.display = 'none'
  document.getElementById('resetPwModalOverlay').classList.add('open')
}

function closeResetPwModal() {
  document.getElementById('resetPwModalOverlay').classList.remove('open')
  _resetPwUserId = null
}

async function saveResetPw() {
  if (!_resetPwUserId) return
  const password = document.getElementById('resetPwValue').value
  const alert    = document.getElementById('resetPwAlert')
  alert.style.display = 'none'

  try {
    const res  = await fetch(`/api/admin/users/${_resetPwUserId}/password`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password })
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Reset failed')
    closeResetPwModal()
    showToast('Password reset successfully', 'success')
  } catch (err) {
    alert.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    alert.textContent   = '✗ ' + err.message
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const al  = document.getElementById('pwAlert')
    const btn = e.target.querySelector('[type=submit]')
    btn.disabled = true
    al.style.display = 'none'

    const data = new FormData(e.target)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
      al.textContent = '✓ Password updated!'
      e.target.reset()
    } catch (err) {
      al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
      al.textContent = '✗ ' + err.message
    } finally {
      btn.disabled = false
    }
  })

  // Order status filter
  document.getElementById('orderStatusFilter')?.addEventListener('change', loadOrders)
})

// ── Close modals on overlay click ─────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.id === 'productModalOverlay') closeProductModal()
  if (e.target.id === 'orderModalOverlay')   closeOrderModal()
  if (e.target.id === 'msgModalOverlay')     closeMsgModal()
  if (e.target.id === 'userModalOverlay')    closeUserModal()
  if (e.target.id === 'resetPwModalOverlay') closeResetPwModal()
})

// ── Site Settings ─────────────────────────────────────────────────────────────
async function loadSiteSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const taglineEl = document.getElementById('settingHeroTagline')
    const shopOpenEl = document.getElementById('settingShopOpen')
    const announcementEl = document.getElementById('settingAnnouncement')
    const announcementActiveEl = document.getElementById('settingAnnouncementActive')

    if (taglineEl)           taglineEl.value       = s.hero_tagline || ''
    if (shopOpenEl)          shopOpenEl.checked    = s.shop_open !== '0'
    if (announcementEl)      announcementEl.value  = s.announcement || ''
    if (announcementActiveEl) announcementActiveEl.checked = s.announcement_active === '1'
  } catch { /* no-op */ }
}

async function saveSiteSettings() {
  const al = document.getElementById('siteSettingsAlert')
  al.style.display = 'none'

  const body = {
    hero_tagline:         document.getElementById('settingHeroTagline')?.value || '',
    shop_open:            document.getElementById('settingShopOpen')?.checked ? '1' : '0',
    announcement:         document.getElementById('settingAnnouncement')?.value || '',
    announcement_active:  document.getElementById('settingAnnouncementActive')?.checked ? '1' : '0',
  }

  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Settings saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Contact & Social Settings ─────────────────────────────────────────────────
async function loadContactSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const set = (id, key) => { const el = document.getElementById(id); if (el) el.value = s[key] || '' }
    set('settingContactEmail',    'contact_email')
    set('settingContactPhone',    'contact_phone')
    set('settingContactAddress',  'contact_address')
    set('settingSocialFacebook',  'social_facebook')
    set('settingSocialInstagram', 'social_instagram')
    set('settingSocialTiktok',    'social_tiktok')
  } catch { /* no-op */ }
}

async function saveContactSettings() {
  const al = document.getElementById('contactAlert')
  al.style.display = 'none'
  const body = {
    contact_email:   document.getElementById('settingContactEmail')?.value || '',
    contact_phone:   document.getElementById('settingContactPhone')?.value || '',
    contact_address: document.getElementById('settingContactAddress')?.value || '',
  }
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Contact info saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

async function saveSocialSettings() {
  const al = document.getElementById('socialAlert')
  al.style.display = 'none'
  const body = {
    social_facebook:  document.getElementById('settingSocialFacebook')?.value || '',
    social_instagram: document.getElementById('settingSocialInstagram')?.value || '',
    social_tiktok:    document.getElementById('settingSocialTiktok')?.value || '',
  }
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Social links saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Hours Settings ────────────────────────────────────────────────────────────
async function loadHoursSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    days.forEach(d => {
      const el = document.getElementById(`settingHours${d}`)
      if (el) el.value = s[`hours_${d.toLowerCase()}`] || ''
    })
  } catch { /* no-op */ }
}

async function saveHoursSettings() {
  const al = document.getElementById('hoursAlert')
  al.style.display = 'none'
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const body = {}
  days.forEach(d => {
    body[`hours_${d.toLowerCase()}`] = document.getElementById(`settingHours${d}`)?.value || ''
  })
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Business hours saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── SEO Settings ──────────────────────────────────────────────────────────────
async function loadSeoSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const titleEl = document.getElementById('settingSeoTitle')
    const descEl  = document.getElementById('settingSeoDescription')
    if (titleEl) titleEl.value = s.seo_title || ''
    if (descEl)  descEl.value  = s.seo_description || ''
  } catch { /* no-op */ }
}

async function saveSeoSettings() {
  const al = document.getElementById('seoAlert')
  al.style.display = 'none'
  const body = {
    seo_title:       document.getElementById('settingSeoTitle')?.value || '',
    seo_description: document.getElementById('settingSeoDescription')?.value || '',
  }
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ SEO settings saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Order Settings ────────────────────────────────────────────────────────────
async function loadOrderSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const set = (id, key) => { const el = document.getElementById(id); if (el) el.value = s[key] || '' }
    set('settingOrderNoticeHours',  'order_notice_hours')
    set('settingOrderMaxQty',       'order_max_qty')
    set('settingOrderMaxDaysAhead', 'order_max_days_ahead')
    set('settingOrderDailyLimit',   'order_daily_limit')
  } catch { /* no-op */ }
}

async function saveOrderSettings() {
  const al = document.getElementById('orderSettingsAlert')
  al.style.display = 'none'
  const body = {
    order_notice_hours:  document.getElementById('settingOrderNoticeHours')?.value  || '',
    order_max_qty:       document.getElementById('settingOrderMaxQty')?.value       || '',
    order_max_days_ahead:document.getElementById('settingOrderMaxDaysAhead')?.value || '',
    order_daily_limit:   document.getElementById('settingOrderDailyLimit')?.value   || '',
  }
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Order settings saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Site Identity ─────────────────────────────────────────────────────────────
async function loadSiteIdentity() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const nameEl   = document.getElementById('settingSiteName')
    const footerEl = document.getElementById('settingFooterText')
    if (nameEl)   nameEl.value   = s.site_name   || ''
    if (footerEl) footerEl.value = s.footer_text  || ''
  } catch { /* no-op */ }
}

async function saveSiteIdentity() {
  const al = document.getElementById('siteIdentityAlert')
  al.style.display = 'none'
  const body = {
    site_name:   document.getElementById('settingSiteName')?.value   || '',
    footer_text: document.getElementById('settingFooterText')?.value || '',
  }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Maintenance Settings ───────────────────────────────────────────────────────
async function loadMaintenanceSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const modeEl    = document.getElementById('settingMaintenanceMode')
    const msgEl     = document.getElementById('settingMaintenanceMessage')
    if (modeEl) modeEl.checked = s.maintenance_mode === '1'
    if (msgEl)  msgEl.value    = s.maintenance_message || ''
  } catch { /* no-op */ }
}

async function saveMaintenanceSettings() {
  const al = document.getElementById('maintenanceAlert')
  al.style.display = 'none'
  const body = {
    maintenance_mode:    document.getElementById('settingMaintenanceMode')?.checked ? '1' : '0',
    maintenance_message: document.getElementById('settingMaintenanceMessage')?.value || '',
  }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Homepage Toggles ───────────────────────────────────────────────────────────
async function loadHomepageToggles() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const set = (id, key) => { const el = document.getElementById(id); if (el) el.checked = s[key] !== '0' }
    set('settingShowFeatured',   'show_featured_section')
    set('settingShowNew',        'show_new_section')
    set('settingShowExamples',   'show_examples_section')
    set('settingShowAssistants', 'show_assistants_section')
    const txtEl = document.getElementById('settingAssistantsText')
    if (txtEl) txtEl.value = s.assistants_text || ''
  } catch { /* no-op */ }
}

async function saveHomepageToggles() {
  const al = document.getElementById('homepageToggleAlert')
  al.style.display = 'none'
  const body = {
    show_featured_section:   document.getElementById('settingShowFeatured')?.checked   ? '1' : '0',
    show_new_section:        document.getElementById('settingShowNew')?.checked        ? '1' : '0',
    show_examples_section:   document.getElementById('settingShowExamples')?.checked   ? '1' : '0',
    show_assistants_section: document.getElementById('settingShowAssistants')?.checked ? '1' : '0',
    assistants_text:         document.getElementById('settingAssistantsText')?.value   || '',
  }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Shop Content Settings ─────────────────────────────────────────────────────
async function loadShopContent() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const set = (id, key) => { const el = document.getElementById(id); if (el) el.value = s[key] || '' }
    set('settingShopClosedMessage', 'shop_closed_message')
    set('settingAllergenNotice',    'allergen_notice')
    set('settingOrderFormIntro',    'order_form_intro')
    set('settingPaymentMethods',    'payment_methods')
  } catch { /* no-op */ }
}

async function saveShopContent() {
  const al = document.getElementById('shopContentAlert')
  al.style.display = 'none'
  const body = {
    shop_closed_message: document.getElementById('settingShopClosedMessage')?.value || '',
    allergen_notice:     document.getElementById('settingAllergenNotice')?.value    || '',
    order_form_intro:    document.getElementById('settingOrderFormIntro')?.value    || '',
    payment_methods:     document.getElementById('settingPaymentMethods')?.value    || '',
  }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Delivery Settings ─────────────────────────────────────────────────────────
async function loadDeliverySettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const enabledEl = document.getElementById('settingDeliveryEnabled')
    const feeEl     = document.getElementById('settingDeliveryFee')
    const minEl     = document.getElementById('settingMinimumOrderValue')
    if (enabledEl) enabledEl.checked = s.delivery_enabled === '1'
    if (feeEl)     feeEl.value       = s.delivery_fee || ''
    if (minEl)     minEl.value       = s.minimum_order_value || ''
  } catch { /* no-op */ }
}

async function saveDeliverySettings() {
  const al = document.getElementById('deliveryAlert')
  al.style.display = 'none'
  const body = {
    delivery_enabled:     document.getElementById('settingDeliveryEnabled')?.checked  ? '1' : '0',
    delivery_fee:         document.getElementById('settingDeliveryFee')?.value         || '0',
    minimum_order_value:  document.getElementById('settingMinimumOrderValue')?.value   || '0',
  }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Email Notification Settings ───────────────────────────────────────────────
async function loadEmailNotifSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const emailEl   = document.getElementById('settingOrderNotificationEmail')
    const fromEl    = document.getElementById('settingEmailFromName')
    const confirmEl = document.getElementById('settingSendCustomerConfirmation')
    if (emailEl)   emailEl.value    = s.order_notification_email  || ''
    if (fromEl)    fromEl.value     = s.email_from_name           || ''
    if (confirmEl) confirmEl.checked = s.send_customer_confirmation !== '0'
  } catch { /* no-op */ }
}

async function saveEmailNotifSettings() {
  const al = document.getElementById('emailNotifAlert')
  al.style.display = 'none'
  const body = {
    order_notification_email:   document.getElementById('settingOrderNotificationEmail')?.value  || '',
    email_from_name:            document.getElementById('settingEmailFromName')?.value           || '',
    send_customer_confirmation: document.getElementById('settingSendCustomerConfirmation')?.checked ? '1' : '0',
  }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── SMTP Settings ─────────────────────────────────────────────────────────────
async function loadSmtpSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || '' }
    set('settingSmtpHost', s.smtp_host)
    set('settingSmtpPort', s.smtp_port)
    set('settingSmtpUser', s.smtp_user)
    set('settingSmtpFrom', s.smtp_from)
    // Never pre-fill the password field; leave blank so saving blank = keep existing
  } catch { /* no-op */ }
}

async function saveSmtpSettings() {
  const al = document.getElementById('smtpAlert')
  al.style.display = 'none'
  const body = {
    smtp_host: document.getElementById('settingSmtpHost')?.value.trim() || '',
    smtp_port: document.getElementById('settingSmtpPort')?.value.trim() || '',
    smtp_user: document.getElementById('settingSmtpUser')?.value.trim() || '',
    smtp_from: document.getElementById('settingSmtpFrom')?.value.trim() || '',
  }
  const pass = document.getElementById('settingSmtpPass')?.value
  if (pass) body.smtp_pass = pass
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    if (pass) document.getElementById('settingSmtpPass').value = ''
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ SMTP settings saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

async function testSmtp() {
  const al = document.getElementById('smtpAlert')
  al.style.cssText = 'display:block;background:#fef3c7;color:#92400e;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
  al.textContent = 'Sending test email…'
  try {
    const res  = await fetch('/api/contact/admin/smtp-test', { method: 'POST' })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Test failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ ' + (json.message || 'Test email sent successfully')
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Analytics Settings ────────────────────────────────────────────────────────
async function loadAnalyticsSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json())
    const gaEl = document.getElementById('settingGoogleAnalyticsId')
    if (gaEl) gaEl.value = s.google_analytics_id || ''
  } catch { /* no-op */ }
}

async function saveAnalyticsSettings() {
  const al = document.getElementById('analyticsAlert')
  al.style.display = 'none'
  const body = { google_analytics_id: document.getElementById('settingGoogleAnalyticsId')?.value || '' }
  try {
    const res  = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Save failed')
    al.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✓ Saved'
  } catch (err) {
    al.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.7rem 1rem;font-size:.9rem'
    al.textContent = '✗ ' + err.message
  }
}

// ── Site Images ───────────────────────────────────────────────────────────────
async function loadSiteImages() {
  const grid = document.getElementById('siteImagesGrid')
  if (!grid) return
  try {
    const slots = await fetch('/api/settings/images').then(r => r.json())
    grid.innerHTML = slots.map(slot => `
      <div class="site-image-slot" id="imgSlot_${slot.key}">
        <div style="font-size:.8rem;font-weight:600;color:#374151;margin-bottom:.5rem">${slot.label}</div>
        <div class="site-img-preview-wrap">
          ${slot.currentUrl
            ? `<img src="${slot.currentUrl}?t=${Date.now()}" class="site-img-preview" alt="${slot.label}">`
            : `<div class="site-img-placeholder">🖼️<div style="font-size:.7rem;margin-top:.3rem;color:#9ca3af">Default image</div></div>`
          }
        </div>
        <div style="display:flex;gap:.4rem;margin-top:.5rem">
          <label class="btn-primary-admin" style="cursor:pointer;font-size:.8rem;padding:.35rem .8rem">
            Upload
            <input type="file" accept="image/*" style="display:none" onchange="uploadSiteImage('${slot.key}', this)">
          </label>
          ${slot.currentUrl ? `<button class="btn-delete-admin" style="font-size:.8rem;padding:.35rem .8rem" onclick="removeSiteImage('${slot.key}')">Remove</button>` : ''}
        </div>
      </div>`).join('')
  } catch { /* no-op */ }
}

async function uploadSiteImage(key, input) {
  const file = input.files[0]
  if (!file) return
  const slot = document.getElementById(`imgSlot_${key}`)
  const fd = new FormData()
  fd.append('image', file)
  try {
    const res  = await fetch(`/api/settings/images/${key}`, { method: 'POST', body: fd })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Upload failed')
    showToast('Image updated!', 'success')
    loadSiteImages()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function removeSiteImage(key) {
  if (!confirm('Remove custom image and revert to the default?')) return
  try {
    const res = await fetch(`/api/settings/images/${key}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Remove failed')
    showToast('Reverted to default', 'success')
    loadSiteImages()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// ── Home Examples ─────────────────────────────────────────────────────────────
async function loadHomeExamples() {
  const el = document.getElementById('homeExamplesList')
  if (!el) return
  try {
    const examples = await fetch('/api/home-examples').then(r => r.json())
    if (!examples.length) {
      el.innerHTML = '<p style="color:#9ca3af;font-size:.85rem">No examples yet. Add one below.</p>'
      return
    }
    el.innerHTML = examples.map(ex => `
      <div id="exSlot_${ex.id}" style="display:flex;gap:1rem;align-items:flex-start;padding:.75rem;background:#f9fafb;border-radius:10px;margin-bottom:.6rem">
        <div style="flex-shrink:0;width:80px;height:60px">
          ${ex.imageUrl
            ? `<img src="${ex.imageUrl}?t=${Date.now()}" alt="${ex.title}" style="width:80px;height:60px;object-fit:cover;border-radius:6px">`
            : `<div style="width:80px;height:60px;border-radius:6px;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:1.4rem">🖼️</div>`
          }
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem">
            <input type="text" value="${ex.title.replace(/"/g, '&quot;')}" id="exTitle_${ex.id}" class="admin-input-field" style="font-size:.9rem;padding:.3rem .6rem;flex:1" placeholder="Title">
            <button class="btn-secondary-admin" style="font-size:.75rem;padding:.3rem .6rem;white-space:nowrap" onclick="saveExampleTitle('${ex.id}')">Save</button>
          </div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <label class="btn-primary-admin" style="cursor:pointer;font-size:.75rem;padding:.25rem .6rem">
              Upload Image
              <input type="file" accept="image/*" style="display:none" onchange="uploadHomeExampleImage('${ex.id}', this)">
            </label>
            ${ex.imageUrl ? `<button class="btn-secondary-admin" style="font-size:.75rem;padding:.25rem .6rem" onclick="removeHomeExampleImage('${ex.id}')">Remove Image</button>` : ''}
            <button class="btn-delete-admin" style="font-size:.75rem;padding:.25rem .6rem" onclick="deleteHomeExample('${ex.id}','${ex.title.replace(/'/g, "&#39;")}')">Delete</button>
          </div>
        </div>
      </div>`).join('')
  } catch { /* no-op */ }
}

async function addHomeExample() {
  const input = document.getElementById('newExampleTitle')
  const alert = document.getElementById('exampleAlert')
  const title = input?.value.trim()
  if (!title) return

  try {
    const res  = await fetch('/api/home-examples', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title })
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed to add')
    input.value = ''
    alert.style.cssText = 'display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:.6rem 1rem;font-size:.85rem'
    alert.textContent   = `✓ "${title}" added`
    await loadHomeExamples()
  } catch (err) {
    alert.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:.6rem 1rem;font-size:.85rem'
    alert.textContent   = '✗ ' + err.message
  }
}

async function saveExampleTitle(id) {
  const input = document.getElementById(`exTitle_${id}`)
  const title = input?.value.trim()
  if (!title) return
  try {
    const res = await fetch(`/api/home-examples/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title })
    })
    if (!res.ok) throw new Error('Save failed')
    showToast('Title updated', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function uploadHomeExampleImage(id, input) {
  const file = input.files[0]
  if (!file) return
  const fd = new FormData()
  fd.append('image', file)
  try {
    const res  = await fetch(`/api/home-examples/${id}/image`, { method: 'POST', body: fd })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Upload failed')
    showToast('Image updated!', 'success')
    loadHomeExamples()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function removeHomeExampleImage(id) {
  if (!confirm('Remove this image?')) return
  try {
    const res = await fetch(`/api/home-examples/${id}/image`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Remove failed')
    showToast('Image removed', 'success')
    loadHomeExamples()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function deleteHomeExample(id, title) {
  if (!confirm(`Delete example "${title}"? This cannot be undone.`)) return
  try {
    const res = await fetch(`/api/home-examples/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Delete failed')
    showToast('Example deleted', 'success')
    loadHomeExamples()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// ── Clear Cache ───────────────────────────────────────────────────────────────
function clearAdminCache() {
  if ('caches' in window) {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()))
  }
  showToast('Cache cleared — reloading…', 'success')
  setTimeout(() => window.location.reload(true), 800)
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initAdmin)
