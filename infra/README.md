# Local infrastructure

```bash
# datastores only (recommended for day-to-day work)
docker compose -f infra/docker-compose.yml up -d

# datastores + the AI service in a container
INTERNAL_SERVICE_TOKEN=$(openssl rand -base64 48) \
  docker compose -f infra/docker-compose.yml --profile ai up -d
```

The backend and frontend are **not** in Compose. Both are edited constantly and
run faster under their own watch mode:

```bash
cd backend && yarn start:dev     # http://localhost:3001
cd frontend && yarn dev          # http://localhost:3000
```

## Ports

| Service | Host port | Note |
|---|---|---|
| PostgreSQL | 5432 | `POSTGRES_PORT` |
| Redis | **6380** | `REDIS_PORT`. Not 6379 — that is commonly already taken |
| Qdrant HTTP | 6333 | `QDRANT_HTTP_PORT` |
| Qdrant gRPC | 6334 | `QDRANT_GRPC_PORT` |
| AI service | 8000 | `AI_SERVICE_PORT`, `ai` profile only |

If you already run Redis on 6379 (Homebrew, another stack), leave
`REDIS_URL=redis://localhost:6379` in `backend/.env` and skip this Redis
service — or point the backend at 6380.

## Safety

Every container and volume is prefixed `hrcopilot-`, and the project is named
`hrcopilot`, so `docker compose down` here cannot touch an unrelated stack.

No secret is baked into any image. `INTERNAL_SERVICE_TOKEN` is required at run
time and `LLM_API_KEY` is optional — without it the AI service still does
retrieval, search and JD evidence mapping, and refuses only generation.
