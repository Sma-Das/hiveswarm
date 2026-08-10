FROM node:22-alpine
WORKDIR /workspace
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm install
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4100
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w @hiveswarm/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@hiveswarm/web"]
