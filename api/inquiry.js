// The contact form's one job: check what was sent, and email it to contact@ through Resend.
// The inbox watcher treats it like any other lead, so this works while the laptop is off.
// RESEND_API_KEY lives in Vercel's settings. Nothing here is logged, because it is someone's message.

const TO = "contact@briefofthefuture.com";
const FROM = "Brief of the Future form <form@briefofthefuture.com>";
const ORIGINS = /^https:\/\/((www\.)?briefofthefuture\.com|[a-z0-9-]+\.vercel\.app)$/;
const MIN_MS = 2500;   // a person takes longer than this; a script does not
const MAX_BYTES = 12000;

const PROBLEMS = {
  slow: "Leads wait too long", follow: "Nobody follows up", questions: "Too many customer questions",
  admin: "Too much manual admin", content: "Content takes too long", money: "Invoices slip through",
  reports: "Reports take too long", other: "Something else",
};
const NEEDS = {
  sales: "Sales", marketing: "Marketing", social: "Social media", support: "Support",
  delivery: "Client delivery", finance: "Finance", analysis: "Analysis", unsure: "Not sure yet",
};

const clean = (value, most) => (typeof value === "string" ? value.trim().slice(0, most) : "");
const oneLine = (value) => value.replace(/[\r\n<>"]+/g, " ").trim();

export function check(body) {
  const name = oneLine(clean(body.name, 100));
  const email = clean(body.email, 254);
  const errors = {};
  if (!name) errors.name = "Enter your name, so I know who to write to.";
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(email)) errors.email = "Enter an email address like you@company.com.";
  const problem = PROBLEMS[Object.hasOwn(PROBLEMS, body.problem) ? body.problem : ""] || "";
  const needs = (Array.isArray(body.need) ? body.need : []).filter((n) => Object.hasOwn(NEEDS, n)).map((n) => NEEDS[n]);
  return { errors, name, email, company: oneLine(clean(body.company, 200)), problem, needs, more: clean(body.more, 4000) };
}

export function letter({ name, email, company, problem, needs, more }) {
  const lines = [`Name: ${name}`, `Email: ${email}`];
  if (company) lines.push(`Company: ${company}`);
  lines.push(`Main problem: ${problem || "not chosen"}`, `Where they want AI: ${needs.join(", ") || "not chosen"}`);
  if (more) lines.push("", more);
  return lines.join("\n");
}

export default async function handler(req, res) {
  const answer = (status, body) => res.status(status).json(body);
  if (req.method !== "POST") return answer(405, { error: "This address only takes the contact form." });
  if (!ORIGINS.test(req.headers.origin || "")) return answer(403, { error: "This form only works from the site." });
  if (Number(req.headers["content-length"] || 0) > MAX_BYTES) return answer(413, { error: "That message is too long." });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  // A bot that fills the hidden field, or sends at machine speed, is told all is well and nothing goes out.
  if (body.site || !(Date.now() - Number(body.started) >= MIN_MS)) return answer(200, { ok: true });

  const form = check(body);
  if (Object.keys(form.errors).length) return answer(422, { errors: form.errors });

  try {
    const sent = await fetch(process.env.RESEND_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: [TO], reply_to: `${form.name} <${form.email}>`,
        subject: "Your message to Brief of the Future", text: letter(form),
      }),
    });
    if (!sent.ok) throw new Error(`Resend answered ${sent.status}`);
  } catch {
    return answer(502, { error: "That didn't send. Please try again, or write to contact@briefofthefuture.com." });
  }
  return answer(200, { ok: true });
}
