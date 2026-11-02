// node tests/serve.mjs 8801   The page and its function together, on a stand-in Resend, for trying it in a browser.
import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "../api/inquiry.js";

const port = Number(process.argv[2] || 8801);
const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };

http.createServer(async (req, res) => {
  if (req.url === "/api/inquiry") {
    let raw = "";
    for await (const part of req) raw += part;
    req.body = raw ? JSON.parse(raw) : {};
    req.headers.origin = "https://www.briefofthefuture.com";
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (b) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(b)); return res; };
    return handler(req, res);
  }
  if (req.url === "/_sent") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(sent)); }
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(await readFile(new URL("../contact.html", import.meta.url)));
  } catch { res.statusCode = 404; res.end("no page"); }
}).listen(port, () => console.log("http://localhost:" + port));
