FROM node:18-alpine

# set working dir
WORKDIR /app

# copy package descriptors and install deps
COPY package.json package-lock.json* ./
RUN npm install --production

# copy source
COPY . .

# expose port and run dev server (nodemon) by default
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "dev"]
