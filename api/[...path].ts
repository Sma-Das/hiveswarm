import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../apps/api/src/server.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await app.ready();
  app.server.emit("request", request, response);
}
