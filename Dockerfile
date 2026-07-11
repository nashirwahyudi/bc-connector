FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=3000
EXPOSE 3000

RUN mkdir -p data

CMD ["npm", "start"]
