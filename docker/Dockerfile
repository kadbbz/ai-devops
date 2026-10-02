FROM public.ecr.aws/docker/library/node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS build
WORKDIR /workspace/package
COPY package/package.json package/package-lock.json ./
RUN npm ci
COPY package/tsconfig.server.json package/tsconfig.json package/vite.config.ts ./
COPY package/src ./src
COPY package/web ./web
RUN npm run build && npm prune --omit=dev

FROM public.ecr.aws/docker/library/node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/package/node_modules ./node_modules
COPY --from=build /workspace/package/dist ./dist
COPY --from=build /workspace/package/web/dist ./web/dist
COPY package/migrations ./migrations
COPY package/package.json ./package.json
RUN mkdir -p /var/lib/devops/files /var/lib/devops/workspaces /var/log/devops/audit && chown -R node:node /var/lib/devops /var/log/devops
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
