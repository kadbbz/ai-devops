FROM public.ecr.aws/docker/library/mysql:8.4.6@sha256:869218921e61d6c3c89820955d63cca42971f0e3e6c1e2792247bbd944ebc6e9 AS runtime-deps
USER root
RUN microdnf install -y git tar gzip xz zstd shadow-utils util-linux findutils procps-ng python3 && microdnf clean all
ARG TARGETARCH
ARG S6_VERSION=3.2.0.2
RUN curl -fsSL https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz -o /tmp/s6-noarch.tar.xz \
 && case "$TARGETARCH" in arm64) ARCH=aarch64;; amd64) ARCH=x86_64;; *) exit 1;; esac \
 && curl -fsSL https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-${ARCH}.tar.xz -o /tmp/s6-arch.tar.xz \
 && tar -C / -Jxpf /tmp/s6-noarch.tar.xz && tar -C / -Jxpf /tmp/s6-arch.tar.xz \
 && useradd -u 1001 -m git && useradd -u 1002 -m devops

FROM docker.gitea.com/gitea:1.24.6-rootless@sha256:91f2b27e080739f0d19dba716c3214f17257c632cf762e545b44ca577e37052c AS gitea
FROM public.ecr.aws/docker/library/node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS frontend
COPY tsconfig.json vite.config.ts ./
COPY web ./web
RUN npx tsc --noEmit && npx vite build

FROM dependencies AS backend
COPY tsconfig.server.json ./
COPY src ./src
RUN npx tsc -p tsconfig.server.json

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

# 从根文件系统创建最终镜像，避免继承 MySQL 镜像的匿名 VOLUME。
FROM scratch AS runtime
COPY --from=runtime-deps / /
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=gitea /app/gitea/gitea /usr/local/bin/gitea
COPY --from=gitea /lib/ld-musl-*.so.1 /lib/
COPY --from=gitea /lib/libc.musl-*.so.1 /lib/
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=frontend /app/web/dist ./web/dist
COPY package.json ./
COPY docker/root/ /
ENV NODE_ENV=production TZ=Asia/Shanghai PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0
EXPOSE 8080
VOLUME ["/data", "/backup"]
ENTRYPOINT ["/init"]
