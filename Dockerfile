FROM node:18-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY . .

RUN ls -la
RUN ls -la prisma/ || echo "prisma folder not found"

RUN npm install --legacy-peer-deps

RUN npx prisma generate

EXPOSE 3001

CMD sh -c "npx prisma migrate deploy && npm start"