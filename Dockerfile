# Start from the node:20-alpine image
FROM node:20-alpine

# Install pnpm using corepack (available in Node.js 16.9.0+)
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

# Set the working directory
WORKDIR /app

# Copy package.json and workspace files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/sheet/package.json ./packages/sheet/

# Copy Prisma schema before installing dependencies
COPY packages/backend/prisma ./packages/backend/prisma

# Install dependencies for the backend and its workspace dependency (sheet)
RUN pnpm install --frozen-lockfile --filter @wafflebase/backend...

# Copy the sheet package source (backend uses type-only imports)
COPY packages/sheet/ ./packages/sheet/

# Copy the rest of the backend files
COPY packages/backend/ ./packages/backend/

# Build the backend
WORKDIR /app/packages/backend
RUN pnpm run build

# Set the working directory for the backend
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port the app runs on
EXPOSE 3000

# Start the backend server
CMD ["pnpm", "run", "start:prod"]
