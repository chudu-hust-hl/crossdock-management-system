# cross-dock-management — frontend

Angular 21 application with the Shipment and Location lists and detail pages. Structure and conventions: [`../docs/architecture.md` §9](../docs/architecture.md#9-frontend).

## Prerequisites

- Node.js 22 (developed with 22.14) and npm
- The backend running (see [`../backend/README.md`](../backend/README.md)). Its `CORS_ORIGIN` must be this app's origin; the default `http://localhost:4200` matches `npm start`.

## Setup and run

```bash
# from frontend/
npm install
npm start              # http://localhost:4200
```

The API base URL is `apiBaseUrl` in `src/environments/environment.ts` (default `http://localhost:3100`, the backend's `PORT`).

## Quality checks

```bash
npm run build
npm test -- --watch=false   # Vitest unit tests
```
