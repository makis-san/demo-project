FROM imbios/bun-node:1.3.1-22-slim

ARG USER_ID=1000
ARG GROUP_ID=1000

# Create non-root user
RUN groupadd -g ${GROUP_ID} appgroup || true && \
    useradd -u ${USER_ID} -g ${GROUP_ID} -m appuser || true

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN bun install --frozen-lockfile --ignore-scripts && \
    bun run generate && \
    chown -R ${USER_ID}:${GROUP_ID} /app

# Apply any pending migrations, write the built-in movements (safe to repeat), then start the dev server
CMD ["sh", "-c", "bunx prisma migrate deploy && bun scripts/seed-movements.ts && bunx vite dev --host 0.0.0.0 --port 3000"]
