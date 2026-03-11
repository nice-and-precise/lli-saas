FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* /app/
RUN npm ci

COPY src /app/src

EXPOSE 3000

CMD ["node", "src/server.js"]

