// Vercel's serverless entry point for every /api/* route. This is a thin
// adapter, not a second copy of the logic — it just hands Vercel's
// request/response (standard Node http objects) to the exact same
// handleApi() that server.js's own always-on server uses locally, so
// there's only ever one place the actual API behavior lives.
import { handleApi } from "../server/server.js";

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  try {
    await handleApi(req, res, url);
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: err.status ? err.message : "Server error" }));
  }
}
