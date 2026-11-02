# One image for both processes: the web app (default command) and the job worker,
# which runs beside it in the same Container App (node --experimental-strip-types src/worker/run.ts).
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && find src -name "*.test.ts" -delete

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/src/lib ./src/lib
COPY --from=build --chown=node:node /app/src/worker ./src/worker
COPY --from=build --chown=node:node /app/samples ./samples
COPY --from=build --chown=node:node /app/policies ./policies
USER node
EXPOSE 3000
CMD ["node", "server.js"]
