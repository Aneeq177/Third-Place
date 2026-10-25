# Deploying the backend to Vultr

Backend: `https://api.3rdplaceonline.tech` (Docker + Caddy for automatic HTTPS).
Frontend: Vercel at `https://3rdplaceonline.tech`.

## 1. Create the VM
- Vultr -> Deploy -> Cloud Compute, Ubuntu 22.04/24.04, 1 GB RAM is enough.
- Note its public IPv4 address.

## 2. DNS (at your .tech registrar)
Add an `A` record: name `api`, value = the VM's IP. Wait until it resolves:
`nslookup api.3rdplaceonline.tech`

## 3. Install Docker on the VM
```bash
ssh root@<VM_IP>
curl -fsSL https://get.docker.com | sh
```
Open ports 80 and 443 if a firewall is on (`ufw allow 80,443/tcp`; Vultr's firewall group too if you made one).

## 4. Get the code and secrets onto the VM
```bash
git clone <your repo url> Third-Place && cd Third-Place
nano .env     # paste your keys (see below); never commit this file
```
`.env` contents:
```
MUSE_API_KEY=...
MUSE_BASE_URL=...
MUSE_MODEL=...
GEMINI_API_KEY=...        # optional fallback
SERPAPI_KEY=...           # optional, cache/mock is used without it
TRANSCRIBE_PROVIDER=muse
```

## 5. Start it
```bash
cd server
docker compose up -d --build
docker compose logs -f
```
Check: `curl https://api.3rdplaceonline.tech/api/health` -> `{"ok":true,...}`

Update later: `git pull && docker compose up -d --build`.

## 6. Point the frontend at it (Vercel env vars, then redeploy)
```
VITE_USE_MOCK=false
VITE_API_URL=https://api.3rdplaceonline.tech
```

## Notes
- State (groups, votes) is in memory, so it resets whenever the container restarts or rebuilds. The `g_demo` group is re-seeded on startup.
- The SerpApi cache lives in the `serpapi-cache` Docker volume.
- Caddy gets the Let's Encrypt certificate on first request once DNS resolves; ports 80/443 must be reachable.
