# Start from the node:20-alpine image
FROM node:20-alpine

# Set pnpm as the package manager
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY packages/backend/package.json ./backend/

# Install dependencies for the backend
RUN pnpm install --frozen-lockfile --filter @wafflebase/backend

# Copy the rest of the backend files
COPY packages/backend/ ./backend/

# Build the backend
WORKDIR /app/backend
RUN pnpm run build

# Set the working directory for the backend
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port the app runs on
EXPOSE 3000

# Start the backend server
CMD ["pnpm", "run", "start:prod"]
