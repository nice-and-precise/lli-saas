FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* /app/
RUN npm ci

COPY index.html /app/index.html
COPY vite.config.js /app/vite.config.js
COPY src /app/src

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

