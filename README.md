# SyncScript

Headless CMS & collaborative workspace engine — an API-first, developer-focused alternative to Notion.

- **Type-safe core**: TypeScript (strict) · Fastify · Zod-validated routes & environment
- **Relational modeling**: PostgreSQL · Prisma — multi-tenant workspaces, RBAC memberships, infinitely nested documents
- **Realtime co-editing**: Yjs CRDTs over Socket.io with debounced Postgres persistence
- **Developer platform**: scoped API keys, Redis-cached public delivery API, token-bucket rate limiting

## Quick start

```bash
docker compose up -d        # postgres:16 + redis:7
cp .env.example .env
npm install
npm run db:migrate
npm run dev                 # http://localhost:3000/healthz
```

See [ROADMAP.md](ROADMAP.md) for the architecture overview and development plan.
