# Deploy on Azure (Student credit)

Run the **whole stack on one Ubuntu VM** with Docker Compose. That is the
cheapest way to test with Azure for Students (~$100 credit).

Do **not** start with AKS, App Service, or separate Postgres/Redis/Blob unless
you need them later — those burn credit faster.

## Recommended size (test)

| Goal | Azure size | Approx |
|---|---|---|
| Smoke / 1 live, few viewers | **B4ms** (4 vCPU, 16 GB) or **D4s_v3** | Fits credit for days–weeks |
| Tighter budget | **B2ms** (2 vCPU, 8 GB) | OK for UI + short 720p smoke only |

Use a region your student offer allows (often East US / West Europe).

**Egress** is what eats credit if you load-test many viewers. Keep tests small.

## 1. Create the VM

Portal or CLI:

```bash
# Login (browser)
az login

# Prefer a student-eligible subscription
az account list -o table
az account set --subscription "<your-subscription-id>"

# Resource group
az group create -n stream-rg -l eastus

# Ubuntu 24.04 VM with public IP (adjust size/region)
az vm create \
  -g stream-rg -n stream-vm \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --size Standard_B4ms \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard

# Open ports (HTTP + ingest)
az vm open-port -g stream-rg -n stream-vm --port 80 --priority 1001
az vm open-port -g stream-rg -n stream-vm --port 443 --priority 1002
az vm open-port -g stream-rg -n stream-vm --port 1935 --priority 1003
az vm open-port -g stream-rg -n stream-vm --port 8890 --priority 1004 --protocol Udp
az vm open-port -g stream-rg -n stream-vm --port 8189 --priority 1005
```

Note the **public IP** from the create output.

## 2. Install Docker on the VM

```bash
ssh azureuser@<PUBLIC_IP>

sudo apt-get update
sudo apt-get install -y git ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker azureuser
# log out / in, or: newgrp docker
```

## 3. Clone and configure

```bash
git clone <your-repo-url> stream
cd stream

# Generate secrets + .env
pnpm setup   # if Node not installed: use node scripts/gen-secrets.mjs after installing node
# Or copy .env.example → .env and fill secrets manually
```

Minimal Node install if needed:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm i -g pnpm
pnpm setup
```

Edit `.env` on the VM:

```bash
PUBLIC_BASE_URL=http://<PUBLIC_IP>          # or https://your.domain later
# Keep compose defaults for Postgres/Redis/MinIO on the same VM for first test
WEBRTC_ADDITIONAL_HOSTS=<PUBLIC_IP>
INGEST_RTMP_URL=rtmp://<PUBLIC_IP>:1935/live
INGEST_SRT_HOST=<PUBLIC_IP>
```

For a first test you can **leave MinIO** in compose (no Azure Blob yet).

Compose uses `coollabsio/minio` (community AGPL build of the last MinIO CE
release). Official Docker Hub `minio/minio` is gone; MinIO AIStor Free needs a
license signup and is optional later.

## 4. Start and seed

```bash
pnpm up          # or: docker compose --env-file .env -f infra/docker-compose.yml up -d --build
pnpm db:seed
```

Open:

- http://`<PUBLIC_IP>` → login  
  - Super admin: `admin@example.com` / `changeme-please`  
  - Tenant: `console@example.com` / `changeme-please`

## 5. Quick test

**Console:** create a live input → copy RTMP → publish from OBS (or ffmpeg) → mint token → preview.

**Synthetic publish** (from the VM, after seed):

```bash
node scripts/smoke-stream.mjs --seconds 60
node scripts/smoke-verify.mjs
```

**LMS-style API:** use `provider.apiKey` from `.seed-output.json` against  
`http://<PUBLIC_IP>/v1/provider/...`.

## 6. Optional: HTTPS

Point a domain (or Azure DNS) at the VM, put Caddy/nginx TLS in front of port
80/443, then set:

```bash
PUBLIC_BASE_URL=https://stream.yourdomain.com
```

Rebuild/restart edge + api so signed URLs use HTTPS.

## 7. Stop burning credit when done

```bash
# Deallocate (keeps disk, stops compute charges)
az vm deallocate -g stream-rg -n stream-vm

# Or delete everything
az group delete -n stream-rg --yes --no-wait
```

## Cost tips (student)

- Prefer **one B-series VM**; avoid AKS / multiple PaaS.
- Do not open Postgres/Redis/MinIO ports publicly.
- Avoid long 500-viewer load tests — **egress** is expensive.
- Deallocate the VM when you are not testing.

## What not to do first

- Full multi-region CDN + Azure Front Door (later).
- Separate Azure Database for PostgreSQL + Cache for Redis + Blob (good for
  production, not for first credit test).
