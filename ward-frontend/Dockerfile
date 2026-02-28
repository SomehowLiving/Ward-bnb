FROM node:18-alpine

# working directory
WORKDIR /app

# install deps
COPY package.json package-lock.json* ./
RUN npm install --production

# copy sources
COPY . .

# expose vite dev port and run dev server binding to all interfaces
ENV PORT=5173
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
