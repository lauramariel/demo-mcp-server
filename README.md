# Demo CRM MCP Server

A demo [MCP](https://modelcontextprotocol.io) server exposing a small CRM
(companies, contacts, deals, activities) as tools. Data is stored in
SQLite via Node's built-in `node:sqlite`, pre-seeded with sample records.
Reads return real data and writes persist across restarts.

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

`npm run dev` runs `src/index.ts` directly via `tsx`, for local iteration
without rebuilding.

Data lives in `data/crm.db`, created and seeded on first run. `npm run
reset-db` wipes it back to the seed data.

### Data directory

The default data directory is `data/` next to the project. Override it
with `DATA_DIR`:

```bash
DATA_DIR=/tmp/demo-crm-data npm start
```

This matters on platforms that restrict which paths a process can write
to — a sandboxed agent gateway, for example, that only allows writes
under `/tmp` or `/.cache`. If `DATA_DIR` isn't set and the default `data/`
directory isn't writable, the server falls back to a directory under the
OS temp dir on its own rather than crashing on startup. Setting `DATA_DIR`
explicitly is still the more predictable option when you can.

Note that `/tmp` and similar sandboxed paths are usually wiped when the
container or pod is recreated, so data won't survive the way it does with
a real volume in Docker/Kubernetes.

## Running as a remote server (for an MCP gateway)

The stdio entrypoint (`npm start`) is for clients that spawn the server as
a subprocess. To expose it over the network for a gateway to connect to,
run the Streamable HTTP entrypoint instead:

```bash
npm run build
MCP_API_KEY=some-long-random-secret PORT=3000 npm run start:http
```

This starts an Express server implementing the [MCP Streamable HTTP
transport](https://modelcontextprotocol.io/docs/concepts/transports) at
`POST/GET/DELETE http://localhost:3000/mcp`, plus a `GET /healthz` check.

It's session-based, per the spec. The first `initialize` call returns an
`Mcp-Session-Id` header, and subsequent requests from that client include
it. Each session gets its own `McpServer`/transport pair, but all sessions
share the same SQLite file, so writes from one client show up in reads
from another.

If `MCP_API_KEY` is set, `/mcp` requests need `Authorization: Bearer
<key>` or they get a 401. If it's unset, the server logs a warning and
runs unauthenticated — fine for localhost testing, not for anything
network-reachable.

Point a gateway at `http://<host>:<port>/mcp`, plus the bearer token if
one is set. If the gateway runs elsewhere and needs to reach this server,
deploy it somewhere reachable (see the Docker section) or tunnel it for
quick local testing with `ngrok http 3000`.

### Querying it with curl

Streamable HTTP is session-based, so it takes three requests: `initialize`,
then the `notifications/initialized` notification, then whatever you
actually want, reusing the `Mcp-Session-Id` header from the first
response.

```bash
HOST=http://localhost:3000   # or your https:// domain
KEY=your-mcp-api-key         # omit the Authorization header entirely if MCP_API_KEY is unset

SID=$(curl -s -i -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' \
  | grep -i "^mcp-session-id" | tr -d '\r' | cut -d' ' -f2)

curl -s -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' -o /dev/null

# list the tools
curl -s -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call one
curl -s -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_pipeline_summary","arguments":{}}}'
```

Skipping straight from `initialize` to `tools/list` gets rejected — the
`notifications/initialized` step is required. Responses come back as
`text/event-stream` (`event: message` / `data: {...}`) rather than plain
JSON; the payload is the `data:` line.

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

Or with Compose, which reads `MCP_API_KEY` from the shell env or a `.env`
file:

```bash
MCP_API_KEY=some-long-random-secret docker compose up -d --build
```

Compose also brings up the `caddy` service described below, so it needs
`DOMAIN` set too. For a plain HTTP container with no TLS in front of it,
use `docker run` instead.

The image is a multi-stage build: TypeScript compiles in a builder stage,
and the runtime stage ships only production `node_modules` and `dist`.
There are no native modules to compile, so it's a plain `node:24-alpine`
with no build toolchain needed. It runs as a non-root user, exposes
`3000`, and has a `HEALTHCHECK` against `/healthz`. `/app/data` is a
volume — mount it, as above, or data resets every time the container is
recreated. `MCP_API_KEY` isn't baked into the image; pass it at run or
deploy time. The image runs the HTTP entrypoint (`dist/http.js`), not the
stdio one.

To deploy to a specific platform (Fly.io, Render, a plain VPS, ECS, etc.),
push the built image to that platform's registry/deploy flow and set
`MCP_API_KEY` (and `PORT` if required) as environment variables there.

## Exposing it over HTTPS

`docker-compose.yml` includes a `caddy` service that terminates TLS in
front of the app and gets a certificate from Let's Encrypt automatically.
The app container no longer publishes port 3000 directly — Caddy is the
only thing on the public ports (80/443), and proxies to the app over the
internal Docker network.

You'll need a domain name with a DNS `A`/`AAAA` record pointing at the
server, and ports 80 and 443 open — 80 for the ACME HTTP-01 challenge,
443 for HTTPS itself. Then:

```bash
DOMAIN=mcp.example.com MCP_API_KEY=some-long-random-secret docker compose up -d --build
```

Caddy requests and renews the certificate for `DOMAIN` automatically and
stores it in the `caddy-data` volume, so it survives restarts. Point the
gateway at `https://mcp.example.com/mcp`.

The `Caddyfile` sets `flush_interval -1` on the reverse proxy, disabling
response buffering — the Streamable HTTP transport's `text/event-stream`
responses need to reach the client as they're written, not batched up.

Alternatives to running Caddy yourself: nginx + certbot works the same
way in principle but needs more manual config, including `proxy_buffering
off;` for the same streaming reason. Cloudflare Tunnel gets you HTTPS
without opening any inbound ports at all, useful behind NAT. And if
you're deploying to a platform like Fly.io, Render, or Cloud Run instead
of a bare server, it likely terminates HTTPS for you already — skip Caddy
and deploy the app image directly.

## CI: building the image automatically

`.github/workflows/docker-publish.yml` builds the image and pushes it to
the GitHub Container Registry on pushes to `main` (tagged `latest` and
the commit SHA), on tags matching `v*.*.*` (tagged with that semver plus
`major.minor`), on PRs targeting `main` (build-only, to catch a broken
Dockerfile before merge), and manually via `workflow_dispatch`.

It builds for both `linux/amd64` and `linux/arm64`, uses the GitHub
Actions cache, and authenticates to `ghcr.io` with the repo's built-in
`GITHUB_TOKEN` — no registry secrets to set up.

After the first successful run on `main`, the image is published at:

```
ghcr.io/lauramariel/demo-mcp-server:latest
```

New packages default to private. Change that from the repo's Packages
sidebar, or grant your deploy server access with `docker login ghcr.io`
using a PAT that has `read:packages`. If the workflow fails to push with
a permissions error, check that Settings → Actions → General → Workflow
permissions is set to "Read and write permissions".

To run the CI-built image instead of building from source on your server,
swap `docker compose up -d --build` for:

```bash
docker pull ghcr.io/lauramariel/demo-mcp-server:latest
docker run -d --name demo-crm -p 3000:3000 \
  -e MCP_API_KEY=some-long-random-secret \
  -v crm-data:/app/data \
  ghcr.io/lauramariel/demo-mcp-server:latest
```

Or add `image: ghcr.io/lauramariel/demo-mcp-server:latest` next to
`build: .` in `docker-compose.yml` and use `docker compose pull` instead
of `--build`.

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
deal for Acme Robotics", or "log a call with Priya Nair".

## Project layout

- `src/db.ts` — schema + seed data
- `src/crm.ts` — data access functions (plain functions over SQL, no MCP-specific code)
- `src/server.ts` — MCP tool registration (zod input schemas, wires tools to `crm.ts`)
- `src/index.ts` — stdio entrypoint
- `src/http.ts` — Streamable HTTP entrypoint (for remote/gateway use)
