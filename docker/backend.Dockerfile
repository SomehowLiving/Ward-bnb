FROM node:18-alpine

# create app directory
WORKDIR /app

# install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# copy source code
COPY . .

# default command to start in dev mode
CMD ["npm", "run", "dev"]
