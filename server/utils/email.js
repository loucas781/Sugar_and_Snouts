'use strict'
const nodemailer = require('nodemailer')
const db = require('../db/connection')

function getPref(key) {
  return db.prepare('SELECT value FROM app_preferences WHERE key = ?').get(key)?.value || ''
}

function getTransporter() {
  const host = getPref('smtp_host')
  const port = getPref('smtp_port')
  const user = getPref('smtp_user')
  const pass = getPref('smtp_pass')
  if (!host || !port) return null

  return nodemailer.createTransport({
    host,
    port: parseInt(port),
    secure: parseInt(port) === 465,
    auth: (user && pass) ? { user, pass } : undefined,
  })
}

function getFromAddress() {
  const fromName = getPref('email_from_name') || getPref('site_name') || 'Sugar & Snouts'
  const smtpFrom = getPref('smtp_from') || getPref('smtp_user')
  return smtpFrom ? `"${fromName}" <${smtpFrom}>` : null
}

function statusLabel(status) {
  const labels = {
    pending:   'Pending',
    confirmed: 'In Preparation',
    ready:     'Ready for Collection',
    collected: 'Collected',
    cancelled: 'Cancelled',
  }
  return labels[status] || status
}

function orderItemsHtml(items) {
  return items.map(i => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f0e8e8">${i.productName}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0e8e8;text-align:center">${i.quantity}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0e8e8;text-align:right">£${i.lineTotal.toFixed(2)}</td>
    </tr>`).join('')
}

async function sendOrderConfirmation(order) {
  const transporter = getTransporter()
  const from = getFromAddress()
  if (!transporter || !from) return

  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items
  const siteName = getPref('site_name') || 'Sugar & Snouts'
  const baseUrl = getPref('site_url') || ''
  const trackUrl = baseUrl ? `${baseUrl}/order-status?id=${order.id}&email=${encodeURIComponent(order.customer_email)}` : ''

  const pickupLine   = order.pickup_slot ? `<p><strong>Pickup slot:</strong> ${order.pickup_slot}</p>` : ''
  const dateLine     = order.order_date  ? `<p><strong>Requested date:</strong> ${order.order_date}</p>` : ''
  const trackLine    = trackUrl ? `<p><a href="${trackUrl}" style="color:#232323">Track your order</a></p>` : ''
  const deliveryLine = order.delivery_type === 'delivery' && order.delivery_address
    ? `<p><strong>Delivery address:</strong><br><span style="white-space:pre-line">${order.delivery_address}</span></p>`
    : ''
  const discountLine = order.discount_amount > 0
    ? `<tr><td colspan="2" style="padding:6px 8px;text-align:right;color:#888">Discount (${order.coupon_code}):</td><td style="padding:6px 8px;text-align:right;color:#888">-£${order.discount_amount.toFixed(2)}</td></tr>`
    : ''
  const vatLine = order.vat_amount > 0
    ? `<tr><td colspan="2" style="padding:6px 8px;text-align:right;color:#888">VAT:</td><td style="padding:6px 8px;text-align:right;color:#888">£${order.vat_amount.toFixed(2)}</td></tr>`
    : ''

  await transporter.sendMail({
    from,
    to: order.customer_email,
    subject: `Order confirmation — ${siteName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
        <h1 style="font-size:1.6rem;color:#232323;margin-bottom:4px">${siteName}</h1>
        <p style="color:#888;margin-top:0">Order confirmation</p>
        <hr style="border:none;border-top:2px solid #F3CDD1;margin:16px 0">
        <p>Hi ${order.customer_name},</p>
        <p>Thanks for your order! We've received it and will be in touch soon.</p>
        <p><strong>Order ID:</strong> <code style="background:#f5f5f5;padding:2px 6px;border-radius:4px">${order.id.slice(0,8).toUpperCase()}</code></p>
        ${pickupLine}${dateLine}${deliveryLine}
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead>
            <tr style="background:#F3CDD1">
              <th style="padding:8px;text-align:left">Item</th>
              <th style="padding:8px;text-align:center">Qty</th>
              <th style="padding:8px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${orderItemsHtml(items)}</tbody>
          <tfoot>
            ${discountLine}${vatLine}
            <tr>
              <td colspan="2" style="padding:8px;text-align:right;font-weight:700">Total</td>
              <td style="padding:8px;text-align:right;font-weight:700">£${order.total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        ${trackLine}
        <p style="color:#888;font-size:.85rem">If you have any questions, just reply to this email.</p>
      </div>`,
  })
}

async function sendStatusUpdate(order, newStatus) {
  const transporter = getTransporter()
  const from = getFromAddress()
  if (!transporter || !from) return

  const siteName = getPref('site_name') || 'Sugar & Snouts'
  const baseUrl = getPref('site_url') || ''
  const trackUrl = baseUrl ? `${baseUrl}/order-status?id=${order.id}&email=${encodeURIComponent(order.customer_email)}` : ''
  const trackLine = trackUrl ? `<p><a href="${trackUrl}" style="color:#232323">View your order status</a></p>` : ''

  const messages = {
    confirmed: "Great news — your order is now being prepared!",
    ready:     "Your order is ready for collection!",
    collected: "Thank you — your order has been marked as collected. Enjoy!",
    cancelled: "Unfortunately your order has been cancelled. Please get in touch if you have any questions.",
  }
  const message = messages[newStatus]
  if (!message) return

  await transporter.sendMail({
    from,
    to: order.customer_email,
    subject: `Your order is ${statusLabel(newStatus)} — ${siteName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
        <h1 style="font-size:1.6rem;color:#232323;margin-bottom:4px">${siteName}</h1>
        <hr style="border:none;border-top:2px solid #F3CDD1;margin:16px 0">
        <p>Hi ${order.customer_name},</p>
        <p>${message}</p>
        <p><strong>Order ID:</strong> <code style="background:#f5f5f5;padding:2px 6px;border-radius:4px">${order.id.slice(0,8).toUpperCase()}</code></p>
        ${trackLine}
        <p style="color:#888;font-size:.85rem">${siteName} — thanks for your order!</p>
      </div>`,
  })
}

async function sendNewOrderNotification(order) {
  const transporter = getTransporter()
  const from = getFromAddress()
  const notifyEmail = getPref('order_notification_email')
  if (!transporter || !from || !notifyEmail) return

  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items
  const siteName = getPref('site_name') || 'Sugar & Snouts'

  await transporter.sendMail({
    from,
    to: notifyEmail,
    subject: `New order from ${order.customer_name} — ${siteName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
        <h1 style="font-size:1.4rem;color:#232323">New order received</h1>
        <p><strong>Customer:</strong> ${order.customer_name} (${order.customer_email})</p>
        ${order.customer_phone ? `<p><strong>Phone:</strong> ${order.customer_phone}</p>` : ''}
        ${order.pickup_slot ? `<p><strong>Pickup slot:</strong> ${order.pickup_slot}</p>` : ''}
        ${order.order_date  ? `<p><strong>Requested date:</strong> ${order.order_date}</p>` : ''}
        ${order.delivery_type === 'delivery' ? `<p><strong>Order type:</strong> 🚚 Delivery</p>` : `<p><strong>Order type:</strong> 🏪 Pickup</p>`}
        ${order.delivery_address ? `<p><strong>Delivery address:</strong><br><span style="white-space:pre-line">${order.delivery_address}</span></p>` : ''}
        ${order.payment_status === 'paid' ? `<p><strong>Payment:</strong> ✓ Paid (Ref: ${order.payment_reference || 'n/a'})</p>` : '<p><strong>Payment:</strong> Unpaid</p>'}
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          <thead><tr style="background:#F3CDD1"><th style="padding:6px 8px;text-align:left">Item</th><th style="padding:6px 8px;text-align:center">Qty</th><th style="padding:6px 8px;text-align:right">Total</th></tr></thead>
          <tbody>${orderItemsHtml(items)}</tbody>
        </table>
        <p><strong>Order total: £${order.total.toFixed(2)}</strong></p>
        ${order.notes ? `<p><strong>Notes:</strong> ${order.notes}</p>` : ''}
      </div>`,
  })
}

module.exports = { sendOrderConfirmation, sendStatusUpdate, sendNewOrderNotification }
