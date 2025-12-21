# Frappe LMS - Production Docker Setup

A production-ready, "just works" Docker setup for Frappe LMS.

## Quick Start (Local)

```bash
cd docker/production
cp .env.example .env
docker compose up -d
# Wait ~2 minutes. Visit: http://lms.localhost
```

## Coolify Deployment (Recommended)

Coolify handles reverse proxy and SSL automatically.

1.  **Add Resource:** Click **"Add New Resource"** → **"Docker Compose Empty"**.
2.  **Compose:** Paste the contents of `docker-compose.yml` into the editor and **Save**.
3.  **Variables:** Add these in the **Environment Variables** tab:
    -   `SITE_NAME`: `onboarding.psympl.com`
    -   `FRAPPE_ADMIN_PASSWORD`: `your_secure_password`
    -   `MARIADB_ROOT_PASSWORD`: `your_secure_db_password`
4.  **Domain:** On the **frontend** service settings:
    -   **Domains**: `https://onboarding.psympl.com`
    -   **Port**: `8080`
5.  **Deploy:** Click **Deploy**. Site is ready when `create-site` logs show "Site setup complete!".

## Default Credentials

| Account      | Username      | Password |
| ------------ | ------------- | -------- |
| Frappe Admin | Administrator | admin    |
| MariaDB Root | root          | admin    |

> ⚠️ **Change these in .env before first deployment!**

## Essential Environment Variables

| Variable                | Default         | Description               |
| ----------------------- | --------------- | ------------------------- |
| `SITE_NAME`             | `lms.localhost` | Your site/domain name     |
| `FRAPPE_ADMIN_PASSWORD` | `admin`         | Administrator password    |
| `MARIADB_ROOT_PASSWORD` | `admin`         | Database root password    |
| `LMS_VERSION`           | `stable`        | Image tag (stable/latest) |

## Common Operations

### Logs & Console

```bash
docker compose logs -f backend         # App logs
docker compose logs -f create-site     # Initialization logs
docker compose exec backend bash       # Container shell
```

### Database & Backups

```bash
# Backup
docker compose exec backend bench --site lms.localhost backup --with-files

# Restore
docker compose exec backend bench --site lms.localhost restore \
    /home/frappe/frappe-bench/sites/lms.localhost/private/backups/FILE.sql.gz
```

### Maintenance

```bash
docker compose pull && docker compose up -d  # Update images
docker compose down -v                       # Reset (DESTRUCTIVE!)
```

## Troubleshooting

-   **"Site not found":** Ensure `SITE_NAME` matches your domain exactly.
-   **502 Bad Gateway:** Backend is still starting or `create-site` hasn't finished.
-   **Initialization issues:** Check logs of `configurator` and `create-site` services.

---

AGPL-3.0 - See [LICENSE](../../license.txt)
