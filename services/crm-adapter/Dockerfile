FROM node:20-alpine

WORKDIR /app

COPY services/crm-adapter/package.json services/crm-adapter/package-lock.json* /app/
RUN npm ci

COPY services/crm-adapter/src /app/src
COPY shared/contracts /app/shared/contracts

EXPOSE 3000

CMD ["node", "src/server.js"]
