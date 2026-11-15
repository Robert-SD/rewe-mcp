# rewe-mcp

Model Context Protocol (MCP) server for **REWE (Germany)**. Search supermarkets, browse weekly discounts (*Angebote*) and brochures (*Prospekte*), search the product catalog, explore recipes, inspect digital eBon receipts and online order history, check your REWE Bonus balance and coupons, manage favorites and Pickup/Delivery baskets, and plan grocery trips.

## Quick Start

### 1. Install & Build

```bash
npm install
npm run build
```

### 2. Configure the mTLS Client Certificate (Required)

REWE's mobile backend (`https://mobile-clients-api.rewe.de` and `https://msco.rewe.de`) requires a client certificate and private key during the TLS handshake. The certificate and private key must be extracted from the REWE Android APK and placed as `certificate.pem` and `private.key` in `~/.config/rewe-mcp/certs/` with `0600` permissions:

```bash
mkdir -p ~/.config/rewe-mcp/certs
chmod 600 ~/.config/rewe-mcp/certs/certificate.pem ~/.config/rewe-mcp/certs/private.key
```

Alternatively, set `REWE_MTLS_CERT` and `REWE_MTLS_KEY` to the file paths or inline PEM contents.

### 3. Log In to Your REWE Account

```bash
npm run login
```

1. In the opened Chrome window, open **DevTools** (`Cmd+Option+I` on macOS / `F12` on Windows/Linux) and switch to the **Console** tab first.
2. Sign in with your REWE account (and 2FA if enabled).
3. Copy the `Failed to launch 'de.rewe.app://redirect?...'` line from the Console and paste it into the terminal prompt.

### 4. Verify Setup

```bash
npm run status
```

Checks mTLS certificate configuration, OAuth session expiry, default market configuration, response cache settings, and performs a live check against the REWE Mobile Clients API.

## Connecting to MCP Clients

### Claude Desktop / Cursor / Antigravity (`stdio`)

```json
{
  "mcpServers": {
    "rewe": {
      "command": "node",
      "args": ["/path/to/rewe-mcp/dist/index.js"],
      "env": {
        "REWE_MARKET_ID": "840174",
        "REWE_ZIP_CODE": "50667",
        "REWE_SERVICE_TYPE": "PICKUP"
      }
    }
  }
}
```

### Streamable HTTP Server

```bash
npm run start:http -- --port 3000 --host 127.0.0.1
```

- Health check: `GET http://127.0.0.1:3000/healthz`
- MCP endpoint: `POST / GET / DELETE http://127.0.0.1:3000/mcp`
- Optional bearer protection: set `MCP_HTTP_AUTH_TOKEN=your-secret-token`

### Docker

```bash
docker build -t rewe-mcp .
docker run -d \
  -p 3000:3000 \
  -v ~/.config/rewe-mcp:/data \
  -e MCP_HTTP_AUTH_TOKEN=your-secret-token \
  rewe-mcp
```

When `/data` exists, `rewe-mcp` automatically looks for `/data/certs/certificate.pem`, `/data/certs/private.key`, `/data/tokens.json`, and `/data/store.json`.

## Available MCP Tools (30 Tools)

### Account, mTLS & REWE Bonus

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_auth_status` | Inspect OAuth session, mTLS cert status, and selected market | Read-only |
| `rewe_get_profile` | Fetch REWE SSO userinfo, customer details, and REWE ID | Read-only |
| `rewe_get_bonus` | Fetch REWE Bonus euro balance, points overview, and article missions | Read-only |
| `rewe_get_coupons` | List available and activated REWE Bonus & app coupons | Read-only |

### Markets & Default Store Configuration

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_search_markets` | Search REWE stores by city, street, name, or PLZ | Read-only |
| `rewe_get_market_details` | Fetch market opening hours, address, phone, and services | Read-only |
| `rewe_get_service_portfolio` | Check Pickup & Delivery availability for a PLZ | Read-only |
| `rewe_get_selected_market` | Read active default `marketId`, `zipCode`, and `serviceType` | Read-only |
| `rewe_set_selected_market` | Persist default market in `store.json` | Stateful (idempotent) |

### Discounts, Brochure & Product Catalog

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_get_discounts` | Fetch weekly market discounts (*Angebote*) grouped by category | Read-only |
| `rewe_search_discounts` | Filter weekly stationary offers by keyword | Read-only |
| `rewe_get_brochure` | Fetch digital weekly brochure (*Prospekt*) metadata | Read-only |
| `rewe_search_products` | Search live Pickup/Delivery assortment by keyword, EAN, or category | Read-only |
| `rewe_get_product_details` | Fetch full product details, ingredients, allergens, and nutrition | Read-only |
| `rewe_get_shop_categories` | Browse REWE online shop category tree for a market | Read-only |
| `rewe_get_product_recalls` | List active REWE safety product recalls (*Produktrückrufe*) | Read-only |

### Recipes

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_search_recipes` | Search REWE recipes by keyword, difficulty, collection, or tags | Read-only |
| `rewe_get_recipe_details` | Fetch recipe ingredients, preparation steps, and nutrition | Read-only |
| `rewe_get_recipe_popular_terms` | Fetch popular recipe search terms | Read-only |

### Digital Receipts (eBons) & Online Orders

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_list_ebons` | List in-store digital receipts (eBons) and Bonus earned | Read-only |
| `rewe_get_ebon_pdf` | Download eBon PDF receipt (base64 or save to `savePath`) | Stateful (idempotent) |
| `rewe_list_orders` | List online Pickup/Delivery order history | Read-only |
| `rewe_get_order_details` | Fetch line items, prices, and timeslot for an online order | Read-only |

### Favorites, Basket & Timeslots

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_get_favorites` | List saved REWE favorite lists and product listings | Read-only |
| `rewe_manage_favorite` | Add or remove a product in a REWE favorite list | Stateful (idempotent) |
| `rewe_get_basket` | Fetch or initialize active Pickup/Delivery basket | Stateful (idempotent) |
| `rewe_set_basket_item` | Set absolute quantity for a `listingId` in the basket (`0` removes) | Stateful (idempotent) |
| `rewe_get_timeslots` | List available Pickup/Delivery timeslots and fees | Read-only |

### Grocery Trip Planning

| Tool | Description | Mode |
| --- | --- | --- |
| `rewe_regular_products` | Analyze purchase frequency, cadence, and items due for restock | Read-only |
| `rewe_plan_grocery_trip` | Match regular products & shopping list against current offers/coupons | Read-only |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `REWE_MTLS_CERT` | `~/.config/rewe-mcp/certs/certificate.pem` | PEM string or path to Cloudflare client cert |
| `REWE_MTLS_KEY` | `~/.config/rewe-mcp/certs/private.key` | PEM string or path to Cloudflare client private key |
| `REWE_TOKENS_FILE` | `~/.config/rewe-mcp/tokens.json` | OAuth token persistence file |
| `REWE_STORE_FILE` | `~/.config/rewe-mcp/store.json` | Default market persistence file |
| `REWE_MARKET_ID` | `840174` | Fallback default market ID (`wwIdent`) |
| `REWE_ZIP_CODE` | `50667` | Fallback default German postal code |
| `REWE_SERVICE_TYPE` | `PICKUP` | Fallback default service (`PICKUP` or `DELIVERY`) |
| `REWE_REFRESH_TOKEN` | None | Optional bootstrap refresh token |
| `REWE_ACCESS_TOKEN` | None | Optional static/ephemeral access token |
| `REWE_MCP_CACHE` | `true` | Set to `false` / `0` / `off` to disable in-memory TTL cache |
| `REWE_MCP_CACHE_MAX_ENTRIES` | `500` | Maximum cached responses in memory |
| `MCP_TRANSPORT` | `stdio` | Set to `http` for Streamable HTTP mode |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind host in HTTP mode |
| `MCP_HTTP_PORT` | `3000` | Listen port in HTTP mode |
| `MCP_HTTP_PATH` | `/mcp` | HTTP MCP route path |
| `MCP_HTTP_AUTH_TOKEN` | None | Optional Bearer token required for HTTP MCP requests |
| `MCP_HTTP_JSON_RESPONSE` | `false` | Set to `true` to prefer JSON responses over SSE |
| `MCP_HTTP_SESSION_IDLE_MS` | `1800000` | Idle session expiry timeout (ms) |

## Development

```bash
npm run build   # Compile TypeScript -> dist/
npm test        # Run offline test suite via node:test + tsx
```

All unit and integration tests run offline with mocked HTTP / mTLS fixtures. No REWE credentials or external network calls are required.

## Disclaimer

This project is an unofficial, community-maintained Model Context Protocol (MCP) server. It is not affiliated with, endorsed by, or sponsored by REWE Markt GmbH or its subsidiaries. All trademarks and brand names belong to their respective owners.

## License

MIT
