FROM node:20-alpine

# Install build tools for mediasoup
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

COPY screenShare-server/package.json ./
RUN npm install

COPY screenShare-server ./ 

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]

