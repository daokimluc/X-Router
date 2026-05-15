# Docker Usage

Create a local `.env` from `.env.example` before running Compose:

```bash
cp .env.example .env
```

Run:

```bash
docker compose up --build
```

Services:

- Gateway: `http://localhost:8080`
- Dashboard: `http://localhost:3000`

The Compose setup mounts:

- `./data:/app/data`
- `./secrets:/app/secrets:ro`

Gateway runtime control-plane state is persisted to `/app/data/gateway-state.json`
inside the container, mapped to `./data/gateway-state.json` on the host.

The images do not copy `.env` or real `secrets/*.json` files. Real secrets are mounted at runtime only.
