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
COPY apps/worker apps/worker
COPY agents agents
ENV NODE_ENV=production
CMD ["npm", "run", "start", "-w", "@hiveswarm/worker"]
