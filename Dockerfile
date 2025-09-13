FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm i --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/app.js"]