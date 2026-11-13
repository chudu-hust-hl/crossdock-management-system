# AGENTS.md — cross-dock-management

Instructions for every AI agent working in this repository. Read this file first.

## Project

- **Name:** `cross-dock-management`
- **Purpose:** University graduation project (software engineering) for managing logistics and cross-dock operations: shipments and shipment segments, physical items, routes, locations, warehouse inbound/outbound scanning, dock tasks, and users with roles.
- **Backend stack:** NestJS, TypeScript, MongoDB, Mongoose (via `@nestjs/mongoose`), ULID public identifiers, Swagger/OpenAPI (`@nestjs/swagger`) for API documentation.
- **Architecture:** Modular monolith. Not microservices.
- **Repository layout (monorepo):** `backend/` (NestJS app, run npm commands from here), `frontend/` (Angular 21, run npm commands from here), `docs/`, `.cursor/rules/`, root `docker-compose.yml` (local MongoDB).
- **Out of scope:** Hardware integrations, AI/ML, RFID, IoT. Message brokers, caches, cloud SDKs and auth providers are only added when a later task explicitly requires them.

## Source of truth

| Topic | Document |
| --- | --- |
| Domain model, collections, identifiers, naming and time conventions | `docs/domain-model.md` |
| Field-level Mongoose schema design (types, defaults, indexes, validation) | `docs/schema-design.md` |
| Business workflows: Location sources and reuse, shipment creation, routing | `docs/business-workflows.md` |
| Scanning, dock tasks, and how Item, Route, and Shipment status change | `docs/scanning-flows.md` |
| Module structure, layer responsibilities, roadmap | `docs/architecture.md` |

`.cursor/rules/` contains short summaries of these documents. If a rule and a document disagree, the document wins; point out the inconsistency.

## Working rules

1. **Inspect first.** Read the existing code and the relevant `docs/` files before changing anything. Identify the requirements and existing patterns that apply to the task.
2. **Smallest reasonable change.** Do only what the task asks. Do not implement unrelated features, refactor unrelated code, or add placeholder code.
3. **Keep it understandable.** The code must be explainable by a student in a thesis defense. Prefer explicit, readable code over clever abstractions. No base classes, repositories, factories or generic layers without a concrete need.
4. **No unnecessary dependencies.** Add a package only when the task needs it, and use versions compatible with the existing ones.
5. **Do not change agreed design decisions silently.** If a requirement conflicts with `docs/domain-model.md` or `docs/architecture.md`, explain the conflict and ask before changing the architecture or domain model.
6. **Preserve existing work.** Never delete or overwrite files (including `.env`, Docker volumes, and data) without reviewing them and having a reason.
7. **No secrets in source control.** Configuration comes from environment variables; `.env` is never committed.

## Verification and reporting

- After implementing, run the relevant commands (build, lint, tests, and others as applicable) and report their actual output.
- Never claim a build, test or command succeeded unless it was executed and observed to succeed.
- If a command could not be run (missing tool, sandbox, no network), say so explicitly instead of guessing.
- When documentation is affected by a change that was approved, update the relevant `docs/` file in the same task.
