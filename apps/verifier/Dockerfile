FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/verifier/package.json apps/verifier/package.json
COPY packages/node-protocol/package.json packages/node-protocol/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci
COPY apps/verifier apps/verifier
COPY packages/node-protocol packages/node-protocol
COPY packages/security packages/security
RUN npm run build -w @spilledcinema/verifier

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/verifier/dist ./apps/verifier/dist
USER node
CMD ["node", "apps/verifier/dist/index.mjs"]
