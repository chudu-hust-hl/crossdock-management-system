# cross-dock-management — backend

NestJS modular monolith with MongoDB (Mongoose). Architecture and domain rules: [`../docs/architecture.md`](../docs/architecture.md), [`../docs/domain-model.md`](../docs/domain-model.md).

## Prerequisites

- Node.js 22 (developed with 22.14) and npm
- Docker (for local MongoDB)

## Setup

```bash
# from the repository root: start MongoDB on localhost:27018
docker compose up -d

# from backend/
cp .env.example .env   # skip if .env already exists
npm install
```

## Run

```bash
npm run start:dev      # watch mode
npm run start          # single run
npm run build && npm run start:prod
```

### API documentation (Swagger)

With the app running, open:

- **Swagger UI:** <http://localhost:3000/docs>. It lists every endpoint with its request and response schemas, and "Try it out" sends real requests.
- **OpenAPI JSON:** <http://localhost:3000/docs-json>. This can be imported into Postman or a client generator.

Replace `3000` if `PORT` in `.env` is different. The startup log prints the exact Swagger URL.

`GET http://localhost:3000/health` returns `{ "status": "ok" }` when the API process is running. It does not check MongoDB; the startup log line `MongoDB connected` and `docker compose ps` show the database state.

## Quality checks

```bash
npm run build
npm run lint           # note: runs eslint with --fix
npm test               # unit and schema-definition tests, no database needed
npm run test:e2e       # e2e + MongoDB integration tests, requires MongoDB
```

Each integration test file uses its own database (`cross_dock_management_test_<name>`), which it empties before running and drops afterwards. The development database is not touched.

## Environment variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | HTTP port |
| `MONGODB_URI` | `mongodb://localhost:27018/cross_dock_management` | MongoDB connection string (required) |
| `PRICING_BASE_FEE` | `20000` | Booking cost: fixed fee per shipment, in VND |
| `PRICING_FEE_PER_ITEM` | `5000` | Booking cost: fee per item, in VND |
| `PRICING_FEE_PER_KG` | `3000` | Booking cost: fee per kg of total weight, in VND |

The three `PRICING_*` variables are set together or not at all; the values above are examples, not an agreed tariff. Without them the app starts, but `POST /shipments/book` answers `503`. The formula is in [`../docs/business-workflows.md` §4.3](../docs/business-workflows.md#43-cost).
