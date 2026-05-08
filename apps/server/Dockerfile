FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "run", "start", "-w", "@spilledcinema/server"]
