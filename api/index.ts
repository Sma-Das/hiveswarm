import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../apps/api/src/server.js";

function restoreApiPath(request: IncomingMessage) {
  const url = new URL(request.url ?? "/api", "http://hiveswarm.local");
  const path = url.searchParams.get("path");
  if (!path) return;
  url.searchParams.delete("path");
  const query = url.searchParams.toString();
  request.url = `/api/${path}${query ? `?${query}` : ""}`;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  restoreApiPath(request);
  await app.ready();
  app.server.emit("request", request, response);
}
