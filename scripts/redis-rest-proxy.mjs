#!/usr/bin/env node
/**
 * Thin proxy that adds Upstash-compatible REST URL paths on top of SRH.
 * SRH only supports POST command format; this translates:
 *   GET /get/{key}          → POST ["GET", key]
 *   GET /set/{key}/{value}  → POST ["SET", key, value]
 *   POST /pipeline          → forwarded as-is
 *   POST /                  → forwarded as-is
 *
 * Usage: UPSTREAM=http://127.0.0.1:8079 PORT=8078 node redis-rest-proxy.mjs
 */

import http from 'node:http';

const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:8079';
const PORT = parseInt(process.env.PORT || '8078', 10);

async function forward(method, path, headers, body) {
  const resp = await fetch(`${UPSTREAM}${path}`, {
    method,
    headers: { ...headers, host: undefined },
    body,
  });
  const text = await resp.text();
  return { status: resp.status, headers: Object.fromEntries(resp.headers), text };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const auth = req.headers.authorization || '';

  // POST requests: forward directly to SRH (commands, pipeline, multi-exec)
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const result = await forward('POST', url.pathname, { authorization: auth, 'content-type': 'application/json' }, body);
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(result.text);
    return;
  }

  // GET /: welcome
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('"Welcome to Serverless Redis HTTP!"');
    return;
  }

  // GET /{command}/{args...}: translate to POST ["COMMAND", arg1, arg2, ...]
  const parts = url.pathname.slice(1).split('/');
  const command = parts[0].toUpperCase();
  // Rejoin remaining parts — keys may contain encoded colons
  const args = parts.slice(1).map(decodeURIComponent);
  const cmd = [command, ...args];

  try {
    const result = await forward('POST', '/', { authorization: auth, 'content-type': 'application/json' }, JSON.stringify(cmd));
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(result.text);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Redis REST proxy listening on 127.0.0.1:${PORT} → ${UPSTREAM}`);
});
