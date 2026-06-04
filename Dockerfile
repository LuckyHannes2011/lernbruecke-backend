
FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# package.json zuerst
COPY package*.json ./

# prisma/schema.prisma VOR npm install kopieren
# (postinstall führt "prisma generate" aus – schema muss bereits da sein)
COPY prisma ./prisma/

# Dependencies installieren (postinstall: prisma generate läuft jetzt erfolgreich)
RUN npm install --legacy-peer-deps

# Quellcode kopieren
COPY src ./src/

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]