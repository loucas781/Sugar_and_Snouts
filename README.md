# Sugar & Snouts

Website for Sugar & Snouts — a homemade bakery business selling cookies, cupcakes, and treats for humans and pets.

Built with Node.js + Express and SQLite. The admin panel lets the owner manage products, view orders, and respond to contact messages. The public shop lets customers browse items and submit order enquiries.

---

## Features

- **Public shop** — browse products by category, add to cart, submit an order enquiry
- **Homepage sections** — dynamically pulls Featured, New, and Recommended products from the database
- **Admin panel** — product CRUD with image upload, order management, contact message inbox, settings
- **Secure authentication** — bcrypt + HMAC-SHA256 pepper, password policy enforcement, brute-force lockout, JWT with token_version revocation, audit log
- **Version badge** — colour-coded badge showing environment and version (green dev / orange staging / red prod)
- **ProxMox deployment** — interactive host setup script + in-container installer with systemd service

---

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Runtime    | Node.js 20                          |
| Framework  | Express 4                           |
| Database   | SQLite via better-sqlite3 (WAL mode)|
| Auth       | JWT (HTTP-only cookie) + bcryptjs   |
| File upload| Multer                              |
| Frontend   | Vanilla JS + Bootstrap 5            |
| Deployment | ProxMox LXC (Debian 12)             |

---

## Getting Started

**Prerequisites:** Node.js 20+

```bash
# Install dependencies
npm install

# Run database migration (creates tables and seeds default admin)
npm run setup

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`.
Admin panel: `http://localhost:3000/admin/`

Default dev credentials (from `.env.development`):
- Email: `admin@sugarandsnouts.co.uk`
- Password: `Admin1234!`

> Change the admin password at first login.

---

## Environment Variables

Copy `.env.example` and fill in the values:

```bash
cp .env.example .env.development
```

Key variables:

| Variable             | Description                                              |
|----------------------|----------------------------------------------------------|
| `JWT_SECRET`         | Secret for signing JWTs — generate with `openssl rand -hex 48` |
| `PASSWORD_PEPPER`    | HMAC-SHA256 pepper applied before bcrypt — generate with `openssl rand -hex 32` |
| `PASSWORD_PEPPER_OLD`| Set when rotating the pepper — enables transparent re-hash on login |
| `ADMIN_EMAIL`        | Seeded on first `migrate.js` run                        |
| `ADMIN_PASSWORD`     | Seeded on first `migrate.js` run                        |
| `DATABASE_PATH`      | Absolute path to the SQLite database file               |
| `UPLOAD_PATH`        | Absolute path for uploaded product images               |
| `COOKIE_SECURE`      | Set `true` in staging/production (requires HTTPS)       |
| `TRUST_PROXY`        | Set `true` if behind a reverse proxy                    |

---

## Project Structure

```
├── server/
│   ├── index.js              # Express app entry point
│   ├── auth-utils.js         # Password hashing, pepper, policy
│   ├── audit.js              # Audit log helper
│   ├── db/
│   │   ├── connection.js     # SQLite connection (WAL mode)
│   │   └── migrate.js        # Schema migration + seed
│   ├── middleware/
│   │   └── auth.js           # requireAuth / optionalAuth
│   └── routes/
│       ├── auth.js           # Login, logout, password change
│       ├── products.js       # Product CRUD + image upload
│       ├── orders.js         # Order enquiries
│       └── contact.js        # Contact form
├── public/
│   ├── index.html            # Homepage
│   ├── shop.html             # Shop page
│   ├── contact.html          # Contact page
│   ├── css/app.css           # App styles
│   ├── js/
│   │   ├── app.js            # Shared: cart, toasts, version badge
│   │   ├── home.js           # Homepage dynamic sections
│   │   ├── shop.js           # Shop filtering and rendering
│   │   └── admin.js          # Admin panel SPA logic
│   └── admin/
│       ├── login.html        # Admin login
│       └── dashboard.html    # Admin dashboard
├── proxmox/
│   ├── ct/sugarandsnouts.sh          # Host whiptail setup script
│   └── install/sugarandsnouts-install.sh  # In-container installer
├── .github/workflows/version.yml    # Auto-incrementing version workflow
├── .env.example              # Environment variable reference
└── .version                  # Current version string
```

---

## GitHub Actions — Versioning

Enable in repo **Settings → Actions → General → Read and write permissions**.

| Branch    | Behaviour                                                        |
|-----------|------------------------------------------------------------------|
| `develop` | Increments build counter on every push — e.g. `0.0.1-dev.42`   |
| `staging` | Bumps patch + `-rc` suffix on PR merge — e.g. `0.0.2-rc`       |
| `main`    | Bumps minor, clean version on PR merge — e.g. `0.1.0`          |

The version is displayed in the topbar environment badge.

---

## Proxmox LXC Install

Run this **on your Proxmox host** (not inside a container):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/loucas781/Sugar_and_Snouts/develop/proxmox/ct/sugarandsnouts.sh)"
```

The script will:
1. Present a `whiptail` TUI — choose default or advanced settings (CPU, RAM, disk, network, environment, admin credentials)
2. Download a Debian 12 template automatically if one isn't already present
3. Create and start the LXC container
4. Push the in-container install script and run it — installs Node.js 20, clones the repo, writes `.env`, runs migrations, and starts the `sugarandsnouts` systemd service
5. Print the app URL when complete

---

## Updating

Once installed, an `update.sh` script is placed at `/opt/sugarandsnouts/update.sh` inside the container. To update from your **Proxmox host**:

```bash
pct exec <CTID> -- bash /opt/sugarandsnouts/update.sh
```

Replace `<CTID>` with your container ID (e.g. `100`). The update script will:
1. Pull the latest code from the current branch
2. Run `npm install` to pick up any new dependencies
3. Run database migrations (additive only — no data loss)
4. Restart the `sugarandsnouts` systemd service

You can also run it directly if you have a shell inside the container:

```bash
bash /opt/sugarandsnouts/update.sh
```

---

## Security

- Passwords are HMAC-SHA256 peppered before bcrypt (12 rounds)
- Brute-force lockout after 5 failed attempts (15-minute lockout by default)
- JWT contains `token_version` — incrementing it immediately revokes all sessions for a user
- All admin actions are written to an audit log
- Security headers on every response: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production
