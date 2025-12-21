# Frappe LMS - Production Docker Setup

A production-ready, "just works" Docker setup for Frappe LMS with sensible defaults.

## Quick Start

```bash
# 1. Navigate to the production folder
cd docker/production

# 2. Copy the environment file
cp .env.example .env

# 3. (Optional) Edit .env to customize settings
nano .env

# 4. Start the containers
docker compose up -d

# 5. Wait ~2-3 minutes for initialization, then visit:
#    http://lms.localhost
```

---

## Default Credentials

| Account      | Username      | Password |
| ------------ | ------------- | -------- |
| Frappe Admin | Administrator | admin    |
| MariaDB Root | root          | admin    |

> ⚠️ **Change these in production!** Edit the `.env` file before first deployment.

---

## Environment Variables

All variables have sensible defaults. Copy `.env.example` to `.env` and modify as needed.

### Essential Variables

| Variable                | Default         | Description            |
| ----------------------- | --------------- | ---------------------- |
| `SITE_NAME`             | `lms.localhost` | Your site/domain name  |
| `FRAPPE_ADMIN_PASSWORD` | `admin`         | Administrator password |
| `MARIADB_ROOT_PASSWORD` | `admin`         | Database root password |

### Image Configuration

| Variable      | Default  | Description                       |
| ------------- | -------- | --------------------------------- |
| `LMS_VERSION` | `stable` | Image tag: stable, latest, v1.x.x |
| `PULL_POLICY` | `always` | Docker pull policy                |

### Network/Proxy Settings

| Variable                   | Default     | Description                    |
| -------------------------- | ----------- | ------------------------------ |
| `CLIENT_MAX_BODY_SIZE`     | `50m`       | Max upload file size           |
| `PROXY_READ_TIMEOUT`       | `120`       | Request timeout (seconds)      |
| `UPSTREAM_REAL_IP_ADDRESS` | `127.0.0.1` | Proxy IP (for X-Forwarded-For) |

---

## Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │           Docker Network            │
                                    │                                     │
┌──────────┐     ┌──────────────┐   │   ┌─────────┐      ┌─────────────┐ │
│  Client  │────▶│   Frontend   │───┼──▶│ Backend │◀────▶│   MariaDB   │ │
│          │     │   (Nginx)    │   │   │(Gunicorn)│     │     (DB)    │ │
└──────────┘     │    :8080     │   │   │  :8000  │      │    :3306    │ │
                 └──────────────┘   │   └─────────┘      └─────────────┘ │
                        │           │         │                          │
                        │           │         ▼                          │
                        │           │   ┌─────────────┐   ┌───────────┐  │
                        └───────────┼──▶│  Websocket  │◀─▶│   Redis   │  │
                                    │   │ (Socket.io) │   │  (Cache)  │  │
                                    │   │    :9000    │   │   :6379   │  │
                                    │   └─────────────┘   └───────────┘  │
                                    │                                     │
                                    │   ┌─────────────────────────────┐   │
                                    │   │      Background Workers     │   │
                                    │   │  scheduler, queue-short,    │   │
                                    │   │       queue-long            │   │
                                    │   └─────────────────────────────┘   │
                                    └─────────────────────────────────────┘
```

### Services

| Service        | Description                                  |
| -------------- | -------------------------------------------- |
| `frontend`     | Nginx reverse proxy, serves static files     |
| `backend`      | Frappe/LMS application (Gunicorn)            |
| `websocket`    | Real-time updates (Socket.io)                |
| `scheduler`    | Periodic background tasks                    |
| `queue-short`  | Short-running background jobs                |
| `queue-long`   | Long-running background jobs                 |
| `db`           | MariaDB database                             |
| `redis`        | Cache and message queue                      |
| `configurator` | One-time setup (runs on first start)         |
| `create-site`  | One-time site creation (runs on first start) |

---

## Coolify Deployment

Coolify handles reverse proxy and SSL automatically.

### Step 1: Create a New Docker Compose Service

1. In Coolify, go to your project (e.g., `Homelab > production`)
2. Click **"Add New Resource"**
3. Under **"Docker Based"**, select **"Docker Compose Empty"**
4. You'll see an empty editor with "Start typing here"

### Step 2: Paste the Docker Compose Content

Copy the entire contents of `docker-compose.yml` from this folder and paste it into the editor.

> **Tip:** You can copy it from `docker/production/docker-compose.yml` in this repository.

Click **Save**. Coolify will parse the file and show you all 10 services.

### Step 3: Configure Environment Variables

Go to the **Environment Variables** tab and add these variables:

| Variable                | Value                     | Description                                      |
| ----------------------- | ------------------------- | ------------------------------------------------ |
| `SITE_NAME`             | `your-domain.com`         | Your domain name (e.g., `onboarding.psympl.com`) |
| `FRAPPE_ADMIN_PASSWORD` | `your_secure_password`    | Admin login password                             |
| `MARIADB_ROOT_PASSWORD` | `your_secure_db_password` | Database root password                           |

> **Note:** No port mapping is needed - Coolify connects to containers via Docker's internal network.

### Step 4: Configure Domain for Frontend Service

1. Click on the **frontend** service
2. In **General** settings, set **Domains** to your domain (e.g., `https://your-domain.com`)
3. Ensure **Port** is set to `8080`

### Step 5: Deploy

1. Click **Deploy** and wait for initialization (~2-3 minutes)
2. Check the logs for the **create-site** service - look for "Site setup complete!"
3. Once all services are green, visit your domain

### Troubleshooting Coolify Deployment

**Services stuck in "Starting":**

-   Check the `configurator` logs first - it must complete before others start
-   Then check `create-site` logs for database connection errors

**"Site not found" after deployment:**

-   Verify `SITE_NAME` matches exactly what you set in Environment Variables
-   Check that the **frontend** service has `FRAPPE_SITE_NAME_HEADER` set correctly

**502 Bad Gateway:**

-   The backend may still be starting - wait 1-2 more minutes
-   Check backend logs for errors

---

## Common Operations

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f create-site  # Check initialization
```

### Access Container Shell

```bash
# Backend (Frappe)
docker compose exec backend bash

# Run bench commands
docker compose exec backend bench --site lms.localhost migrate
docker compose exec backend bench --site lms.localhost console
```

### Backup

```bash
# Create backup
docker compose exec backend bench --site lms.localhost backup --with-files

# List backups
docker compose exec backend ls -la sites/lms.localhost/private/backups/
```

### Restore

```bash
docker compose exec backend bench --site lms.localhost restore \
    /home/frappe/frappe-bench/sites/lms.localhost/private/backups/BACKUP_FILE.sql.gz
```

### Update to Latest Version

```bash
# Pull latest images
docker compose pull

# Restart services (migrations run automatically)
docker compose up -d
```

### Reset Everything

```bash
# Stop and remove all data (DESTRUCTIVE!)
docker compose down -v

# Start fresh
docker compose up -d
```

---

## Troubleshooting

### Site Not Loading After Deployment

1. **Check initialization completed:**

    ```bash
    docker compose logs create-site
    ```

    Look for "Site setup complete!" message.

2. **Check all services are running:**

    ```bash
    docker compose ps
    ```

3. **Check backend logs:**
    ```bash
    docker compose logs backend
    ```

### "Site not found" Error

The `SITE_NAME` must match exactly. Check:

```bash
# List created sites
docker compose exec backend ls sites/

# Check current site config
docker compose exec backend cat sites/currentsite.txt
```

### Database Connection Issues

```bash
# Check database health
docker compose logs db

# Test connection from backend
docker compose exec backend bench --site lms.localhost mariadb
```

### Permission Issues

If running on Linux, you may need to fix permissions:

```bash
# Check the frappe user UID (usually 1000)
docker compose exec backend id frappe

# Fix host directory permissions if using bind mounts
sudo chown -R 1000:1000 ./data
```

---

## Using Host Bind Mounts (Optional)

By default, Docker named volumes are used. To use host directories instead (for easier backup/access), modify the volume definitions in `docker-compose.yml`:

```yaml
services:
    backend:
        volumes:
            - ./data/sites:/home/frappe/frappe-bench/sites
            - ./data/logs:/home/frappe/frappe-bench/logs
    # ... apply to all services using sites/logs volumes ...

    db:
        volumes:
            - ./data/mariadb:/var/lib/mysql
```

Then create the directories before starting:

```bash
mkdir -p data/sites data/logs data/mariadb
```

---

## Security Recommendations

1. **Change default passwords** before deployment
2. **Use HTTPS** via Coolify or a reverse proxy
3. **Restrict database access** - don't expose port 3306
4. **Regular backups** - set up automated backup jobs
5. **Keep images updated** - regularly pull latest versions

---

## License

AGPL-3.0 - See [LICENSE](../../license.txt)
