FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/scraper/package.json apps/scraper/
RUN npm ci -w @promo/scraper -w @promo/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/scraper apps/scraper
RUN npm run build -w @promo/shared && npm run build -w @promo/scraper \
 && npm prune --omit=dev -w @promo/scraper -w @promo/shared \
 && mkdir -p packages/shared/node_modules

FROM node:24-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /repo/packages/shared/migrations packages/shared/migrations
COPY --from=build /repo/apps/scraper/package.json apps/scraper/
COPY --from=build /repo/apps/scraper/dist apps/scraper/dist
USER node
CMD ["node", "apps/scraper/dist/index.js"]
