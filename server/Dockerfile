# Cloudflare Containers requires linux/amd64
FROM --platform=linux/amd64 node:24-alpine AS build
WORKDIR /app
# `git` is needed because some Colyseus sub-deps resolve via git URLs.
RUN apk add --no-cache git
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM --platform=linux/amd64 node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=2567
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 2567
CMD ["node", "dist/index.js"]
