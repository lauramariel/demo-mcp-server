# Demo CRM MCP Server

A demo [MCP](https://modelcontextprotocol.io) server exposing a small CRM
(companies, contacts, deals, activities) as tools. Data is stored in SQLite
(Node's built-in `node:sqlite`, no native deps), pre-seeded with sample
records. Reads return real data and writes persist across restarts.

## Tools

**Companies**
- `list_companies` — filter by name search / industry
- `get_company` — company + its contacts + its deals
- `create_company`
- `update_company`

**Contacts**
- `list_contacts` — filter by company / name+email search
- `get_contact` — contact + company + deals + activity history
- `create_contact`
- `update_contact`

**Deals**
- `list_deals` — filter by company / stage
- `get_deal` — deal + company + contact + activity history
- `create_deal`
- `update_deal_stage` — moves a deal through `lead → qualified → proposal → negotiation → won/lost`

**Activities**
- `log_activity` — attach a note/call/email/meeting to a company, contact, or deal

**Search & reporting**
- `search_crm` — search across companies/contacts/deals
- `get_pipeline_summary` — deal count + total value per stage, plus open/won totals

## Requirements

- Node.js 24+ (uses `node:sqlite`)

## Setup

```bash
npm install
npm run build
npm start          # starts the MCP server on stdio
```

For local iteration without rebuilding: `npm run dev` (runs `src/index.ts`
directly via `tsx`).

Data lives in `data/crm.db`, created and seeded automatically on first run.
To reset it to the seed data: `npm run reset-db`.

## Running as a remote server (for an MCP gateway)

The stdio entrypoint (`npm start`) is for clients that spawn the server as
a subprocess. To expose it over the network for a gateway to connect to,
run the Streamable HTTP entrypoint instead:

```bash
npm run build
MCP_API_KEY=some-long-random-secret PORT=3000 npm run start:http
```

This starts an Express server implementing the
[MCP Streamable HTTP transport](https://modelcontextprotocol.io/docs/concepts/transports)
at `POST/GET/DELETE http://localhost:3000/mcp`, plus a `GET /healthz`
check.

It's session-based, per the spec: the first `initialize` call returns an
`Mcp-Session-Id` header, and subsequent requests from that client must
include it. Each session gets its own `McpServer`/transport pair, but all
sessions share the same SQLite file, so writes from one client are visible
to reads from another.

**Auth**: if `MCP_API_KEY` is set, `/mcp` requests must include
`Authorization: Bearer <key>` or they get a 401. If unset, the server logs
a warning and runs unauthenticated — fine for localhost testing, not for
anything network-reachable.

**Pointing a gateway at it**: use `http://<host>:<port>/mcp` as the
Streamable HTTP endpoint, plus the bearer token if one is set. If the
gateway runs elsewhere and needs to reach this server, either deploy it
somewhere the gateway can reach (see Docker section below) or, for quick
local testing, tunnel it with `ngrok http 3000` and use the resulting
`https://*.ngrok.app/mcp` URL.

## Docker

```bash
docker build -t demo-crm-mcp-server .
docker run -d \
  --name demo-crm \
  -p 3000:3000 \
  -e MCP_API_KEY=some-long-random-secret \
  -v crm-data:/app/data \
  demo-crm-mcp-server
```

Or with Compose (reads `MCP_API_KEY` from the shell env or a `.env` file in
this directory):

```bash
MCP_API_KEY=some-long-random-secret docker compose up -d --build
```

(This brings up both the app and the `caddy` service described below, so
it also needs `DOMAIN` set — see the next section. For a plain HTTP
container with no TLS in front of it, use `docker run` as above instead.)

Notes on the image:
- Multi-stage build: compiles TypeScript in a builder stage, ships only
  production `node_modules` + `dist` in the runtime stage.
- No native modules to compile, so it's a plain `node:24-alpine` with no
  build toolchain needed.
- Runs as a non-root user, exposes `3000`, and has a `HEALTHCHECK` against
  `/healthz`.
- `/app/data` (the SQLite file) is a volume. Mount it, as above, so data
  survives container restarts/redeploys — without it, data resets every
  time the container is recreated.
- `MCP_API_KEY` is not baked into the image; pass it at `run`/deploy time.
- The image runs the HTTP entrypoint (`dist/http.js`) by default, not the
  stdio one.

To deploy to a specific platform (Fly.io, Render, a plain VPS, ECS, etc.),
push the built image to that platform's registry/deploy flow and set
`MCP_API_KEY` (and `PORT` if required) as environment variables there.

## Exposing it over HTTPS

`docker-compose.yml` includes a `caddy` service that terminates TLS in
front of the app and gets a certificate automatically from Let's Encrypt.
The app container no longer publishes port 3000 directly — Caddy is the
only thing listening on the public ports (80/443), and it proxies to the
app over the internal Docker network.

Prerequisites on the server:
- A domain name with a DNS `A` (and/or `AAAA`) record pointing at the
  server's public IP.
- Ports 80 and 443 open in the firewall/security group. Port 80 is needed
  for the ACME HTTP-01 challenge Let's Encrypt uses to issue the
  certificate, in addition to serving HTTPS on 443.

Then:

```bash
DOMAIN=mcp.example.com MCP_API_KEY=some-long-random-secret docker compose up -d --build
```

Caddy requests and renews the certificate for `DOMAIN` automatically and
stores it in the `caddy-data` volume, so it persists across restarts.
Point the gateway at `https://mcp.example.com/mcp`.

The `Caddyfile` sets `flush_interval -1` on the reverse proxy, which
disables response buffering — needed because the Streamable HTTP
transport uses `text/event-stream` responses that must reach the client
as they're written, not batched up.

If you'd rather not run Caddy yourself:
- **nginx + certbot** works the same way in principle (reverse proxy to
  `127.0.0.1:3000` or the app container, certbot for the certificate) but
  needs more manual config, including disabling proxy buffering
  (`proxy_buffering off;`) for the same streaming reason.
- **Cloudflare Tunnel** (or a similar tunnel service) gets you HTTPS
  without opening any inbound ports on the server at all — useful if the
  server is behind NAT or you don't want to manage a firewall rule.
- If you're deploying to a platform (Fly.io, Render, Cloud Run, etc.)
  instead of a bare server, it likely terminates HTTPS for you already —
  in that case skip Caddy and just deploy the app image directly.

## CI: building the image automatically

`.github/workflows/docker-publish.yml` builds the Docker image and pushes
it to the GitHub Container Registry (`ghcr.io`) on:
- every push to `main` (tagged `latest` and with the commit SHA),
- every pushed tag matching `v*.*.*` (tagged with that semver, plus
  `major.minor`),
- pull requests targeting `main` (build-only, not pushed — validates the
  image still builds),
- and manually via the "Run workflow" button (`workflow_dispatch`).

It builds for both `linux/amd64` and `linux/arm64`, and uses the GitHub
Actions cache so incremental builds are fast. It authenticates to `ghcr.io`
with the repo's built-in `GITHUB_TOKEN` — no registry secrets to set up.

After the first successful run on `main`, the image is published at:

```
ghcr.io/lauramariel/demo-mcp-server:latest
```

By default a package published this way is **private**; go to the
package's settings on GitHub (from the repo's sidebar → Packages) if you
want it public, or otherwise grant your deploy server access
(`docker login ghcr.io` with a PAT that has `read:packages`).

If the workflow fails to push with a permissions error, check
**Settings → Actions → General → Workflow permissions** is set to "Read
and write permissions" for the repo.

To run the CI-built image on your server instead of building from source
there, swap `docker compose up -d --build` for:

```bash
docker pull ghcr.io/lauramariel/demo-mcp-server:latest
docker run -d --name demo-crm -p 3000:3000 \
  -e MCP_API_KEY=some-long-random-secret \
  -v crm-data:/app/data \
  ghcr.io/lauramariel/demo-mcp-server:latest
```

(or add `image: ghcr.io/lauramariel/demo-mcp-server:latest` next to
`build: .` in `docker-compose.yml`, then use `docker compose pull` there
instead of `--build`).

## Using it from Claude Code / Claude Desktop

Add it as a local MCP server, e.g. in Claude Code:

```bash
claude mcp add demo-crm -- node /Users/laura/dev/demo-mcp-server/dist/index.js
```

Or in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "demo-crm": {
      "command": "node",
      "args": ["/Users/laura/dev/demo-mcp-server/dist/index.js"]
    }
  }
}
```

Then ask things like "what's in the pipeline right now?", "create a new
deal for Acme Robotics", or "log a call with Priya Nair" — the tools read
and write the SQLite-backed data.

## Project layout

- `src/db.ts` — schema + seed data
- `src/crm.ts` — data access functions (plain functions over SQL, no MCP-specific code)
- `src/server.ts` — MCP tool registration (zod input schemas, wires tools to `crm.ts`)
- `src/index.ts` — stdio entrypoint
- `src/http.ts` — Streamable HTTP entrypoint (for remote/gateway use)
