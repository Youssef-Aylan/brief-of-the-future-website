// node --test tests/   The contact form's function, on a stand-in Resend. Nothing real is sent.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import handler, { check, letter } from "../api/inquiry.js";

let calls, resendStatus;
beforeEach(() => {
  calls = [];
  resendStatus = 200;
  process.env.RESEND_API_KEY = "stand-in";
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (resendStatus === "dead") throw new Error("no network");
    return { ok: resendStatus < 400, status: resendStatus };
  };
});

const good = (over = {}) => ({ name: "Dana Hill", email: "dana@shop.example", company: "Hill Plumbing", problem: "slow",
  need: ["sales", "support"], more: "We miss calls.", site: "", started: Date.now() - 10000, ...over });

async function post(body, headers = {}) {
  const out = {};
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: "POST", headers: { origin: "https://www.briefofthefuture.com", ...headers }, body }, res);
  return out;
}

test("the browser's time zone reaches the letter, and only a real-looking zone name", async () => {
  await post(good({ tz: "Pacific/Auckland" }));
  assert.match(calls[0].body.text, /^Time zone: Pacific\/Auckland$/m);
  assert.equal(check(good({ tz: "America/Argentina/Buenos_Aires" })).tz, "America/Argentina/Buenos_Aires");
  for (const bad of ["Pacific/Auckland" + String.fromCharCode(10) + "Main problem: x", "<b>x</b>", "x".repeat(80), 7, undefined])
    assert.equal(check(good({ tz: bad })).tz, "");
  assert.doesNotMatch(letter(check(good())), /Time zone/);
});

test("a good form goes to contact@ once, with the lead as Reply-To", async () => {
  const out = await post(good());
  assert.equal(out.status, 200);
  assert.equal(calls.length, 1);
  const b = calls[0].body;
  assert.deepEqual(b.to, ["contact@briefofthefuture.com"]);
  assert.equal(b.reply_to, "Dana Hill <dana@shop.example>");
  assert.match(b.from, /form@briefofthefuture\.com/);
  assert.match(b.text, /Main problem: Leads wait too long/);
  assert.match(b.text, /Where they want AI: Sales, Support/);
  assert.match(b.text, /We miss calls\./);
  assert.equal(calls[0].init.headers.Authorization, "Bearer stand-in");
});

test("the sender is not contact@, which the watcher would hold as our own mail", async () => {
  await post(good());
  assert.doesNotMatch(calls[0].body.from, /contact@/);
});

test("no name or a bad email is refused with words for each field, and nothing is sent", async () => {
  const out = await post(good({ name: "  ", email: "not an email" }));
  assert.equal(out.status, 422);
  assert.ok(out.body.errors.name && out.body.errors.email);
  assert.equal(calls.length, 0);
});

test("the hidden field or machine speed gets a thank-you and sends nothing", async () => {
  assert.equal((await post(good({ site: "http://spam.example" }))).status, 200);
  assert.equal((await post(good({ started: Date.now() }))).status, 200);
  assert.equal((await post(good({ started: undefined }))).status, 200);
  assert.equal(calls.length, 0);
});

test("another site cannot use this, and neither can a GET or a huge post", async () => {
  assert.equal((await post(good(), { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(good(), { origin: "" })).status, 403);
  assert.equal((await post(good(), { "content-length": "99999" })).status, 413);
  const out = {};
  await handler({ method: "GET", headers: {} }, { status(s) { out.status = s; return this; }, json() { return this; } });
  assert.equal(out.status, 405);
  assert.equal(calls.length, 0);
});

test("a preview address and the bare domain both work", async () => {
  assert.equal((await post(good(), { origin: "https://briefofthefuture.com" })).status, 200);
  assert.equal((await post(good(), { origin: "https://brief-abc123.vercel.app" })).status, 200);
});

test("Resend refusing or no network says so, instead of a false thank-you", async () => {
  resendStatus = 500;
  let out = await post(good());
  assert.equal(out.status, 502);
  assert.match(out.body.error, /contact@briefofthefuture\.com/);
  resendStatus = "dead";
  out = await post(good());
  assert.equal(out.status, 502);
});

test("a name cannot smuggle in another address or header", async () => {
  await post(good({ name: 'Eve\r\nBcc: x@evil.example <y@evil.example>"' }));
  const r = calls[0].body.reply_to;
  assert.doesNotMatch(r, /[\r\n]/);
  assert.equal((r.match(/</g) || []).length, 1);
});

test("unknown choices are dropped, and a long message is cut", () => {
  const f = check(good({ problem: "constructor", need: ["sales", "__proto__", "nope"], more: "x".repeat(9000) }));
  assert.equal(f.problem, "");
  assert.deepEqual(f.needs, ["Sales"]);
  assert.equal(f.more.length, 4000);
  assert.match(letter(f), /Main problem: not chosen/);
});

test("the choices are optional, as the page says", async () => {
  const out = await post(good({ problem: undefined, need: undefined, company: "", more: "" }));
  assert.equal(out.status, 200);
  assert.doesNotMatch(calls[0].body.text, /Company/);
});
