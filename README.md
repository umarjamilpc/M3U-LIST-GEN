# M3U-LIST-GEN

Build a clean, filtered **M3U playlist** for your IPTV players.

You pick a source (iptv-org countries, your own M3U URLs, or uploaded files), choose channels, set an optional EPG link, and generate a shareable playlist URL.

This app **only builds M3U**. It does not download or merge TV guides. For EPG, point to an external URL such as [EPG-LIST-GEN](https://github.com/umarjamilpc/EPG-LIST-GEN).

---

## How it works

1. **Sign in** — default user is `admin` / `admin` (change this in Docker before going live).
2. **Create playlist** — short wizard:
   - **Name** — playlist title and public URL slug  
   - **Source** — iptv-org country list, custom M3U URL(s), and/or uploaded `.m3u` files  
   - **Guide** — paste your external EPG URL(s) (optional)  
   - **Channels** — add channels from the source, arrange categories, edit names  
   - **Generate** — build `playlist.m3u` and publish it  
3. **Use the playlist** — copy the M3U link into TiviMate, VLC, Jellyfin, etc.
4. **Rebuild later** — use **Rebuild** on the dashboard, or set a per-playlist refresh schedule in Settings.

The playlist appears on the dashboard only after you finish **Generate**. Leaving the wizard early does not leave a half-finished playlist on the home page.

---

## Run with Docker (recommended)

Pre-built images for **x86 (amd64)** and **Raspberry Pi (arm64)**:

`ghcr.io/umarjamilpc/m3u-list-gen:latest`

### 1. Edit `docker-compose.yml`

Set a strong password and a random `SECRET_KEY` under `environment:`:

```yaml
environment:
  SECRET_KEY: paste-your-generated-key-here
  ADMIN_USERNAME: admin
  ADMIN_PASSWORD: your-strong-password
```

#### How to create `SECRET_KEY`

`SECRET_KEY` signs login cookies. It should be a long random string (32+ characters). Generate one once and keep it private — do not commit it to Git.

**Linux / macOS / Unraid terminal:**

```bash
openssl rand -hex 32
```

**Windows PowerShell:**

```powershell
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]).ToLower()
```

Or with OpenSSL (if installed):

```powershell
openssl rand -hex 32
```

**Node.js (any OS):**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Example output (yours will be different):

```text
a3f8c1e92b7d4a6e0f1c8b9d2e5a7c0f3b6d9e1a4c7f0b2d5e8a1c4f7b0d3e6
```

Paste that value as `SECRET_KEY` in `docker-compose.yml`. If you change `SECRET_KEY` later, everyone will be logged out and must sign in again.

Data is stored on the host (survives updates and restarts):

```yaml
volumes:
  - /mnt/user/appdata/M3U-LIST-GEN/data:/data
```

Change the left-hand path if your server uses a different appdata folder.

### 2. Start

```bash
mkdir -p /mnt/user/appdata/M3U-LIST-GEN/data
docker compose pull
docker compose up -d
```

If the container crashes with `EACCES` / `permission denied` on `/data`, the host folder is not writable. Either:

- recreate/redeploy with the latest image (runs as root and can write to the bind mount), or  
- on Unraid, fix ownership then restart:

```bash
chmod -R 777 /mnt/user/appdata/M3U-LIST-GEN/data
# or, for nobody:users, set in compose:  user: "99:100"
docker compose up -d
```

Open **http://YOUR-SERVER-IP:3000**

### 3. Public access (Nginx Proxy Manager)

You can use **both**:

| Access | Example |
|--------|---------|
| Local / LAN | `http://192.168.1.10:3000` |
| Public HTTPS | `https://m3u.yourdomain.com` |

In Nginx Proxy Manager:

1. Add a Proxy Host for your domain  
2. Forward to `http://YOUR-SERVER-IP:3000` (or the container name if NPM shares the Docker network)  
3. Turn on SSL (Let’s Encrypt)

Playlist links follow how you open the app (HTTP on LAN, HTTPS on the domain). Leave **Settings → Public base URL** empty.

---

## Run locally (development)

Needs **Node.js 22+**.

```bash
npm install
npm start
```

Open http://127.0.0.1:3000 — login `admin` / `admin`.

App data is stored in the `data/` folder next to the project (database, uploads, generated playlists).

---

## EPG (TV guide)

1. Generate your playlist and copy its M3U URL.  
2. Feed that URL into [EPG-LIST-GEN](https://github.com/umarjamilpc/EPG-LIST-GEN) (or any XMLTV source you use).  
3. In this app’s **Guide** step, paste the published EPG URL (for example a `merged-epg.xml.gz` link).  
4. Keep **Put EPG link in M3U** enabled so players load the guide automatically.

---

## Useful URLs

| URL | Purpose |
|-----|---------|
| `/` | Dashboard — your playlists |
| `/u/<user>/<slug>/playlist.m3u` | Public M3U for players |
| `/u/<user>/<slug>/epg.xml.gz` | Only if you uploaded an EPG file here |

---

## Docker environment

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | Yes | Random secret used to sign login cookies (see **How to create SECRET_KEY** above) |
| `ADMIN_USERNAME` | Yes | First admin username |
| `ADMIN_PASSWORD` | Yes | First admin password |

Port **3000** and data path **`/data`** are set in the image. You only need to mount the host folder onto `/data`.

---

## License

Use as you like for your own deployment. [EPG-LIST-GEN](https://github.com/umarjamilpc/EPG-LIST-GEN) is a separate project.
