# ---------------------------------------------------------------------------
# Stage 1: Build (runs on the CI host architecture — no QEMU emulation)
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /app

# Copy package manifests and workspace config
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/sheet/package.json ./packages/sheet/

# Copy Prisma schema (needed by postinstall: prisma generate)
COPY packages/backend/prisma ./packages/backend/prisma

# Install all dependencies (runs natively — fast)
RUN pnpm install --frozen-lockfile --filter @wafflebase/backend...

# Copy source
COPY packages/sheet/ ./packages/sheet/
COPY packages/backend/ ./packages/backend/

# Build sheet → platform-independent JS bundle
WORKDIR /app/packages/sheet
RUN pnpm run build

# Build backend → platform-independent JS via SWC
WORKDIR /app/packages/backend
RUN pnpm run build

# ---------------------------------------------------------------------------
# Stage 2: Runtime (target platform)
# ---------------------------------------------------------------------------
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/sheet/package.json ./packages/sheet/

# Copy Prisma schema (needed for prisma generate)
COPY packages/backend/prisma ./packages/backend/prisma

# Install production dependencies only, skip postinstall scripts to avoid
# needing the prisma CLI (which is a devDependency).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @wafflebase/backend...

# Generate Prisma client for the target platform using npx (one-off).
WORKDIR /app/packages/backend
RUN npx prisma@6.6.0 generate

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/sheet/dist /app/packages/sheet/dist
COPY --from=builder /app/packages/backend/dist /app/packages/backend/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/main"]
