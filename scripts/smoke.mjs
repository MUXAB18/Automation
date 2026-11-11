// Black-box smoke test of a running web server (no browser, no credentials).
//   BASE_URL=http://localhost:3000 node scripts/smoke.mjs
// Verifies what must hold for any deployment: health, security headers, and that protected routes
// refuse anonymous callers without leaking whether anything exists.
const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failures.push(name);
};
const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });

const health = await get("/api/health");
check(
  "health answers 200 ok",
  health.status === 200 && (await health.json()).status === "ok",
  health.status,
);
check("health is not cacheable", /no-store/.test(health.headers.get("cache-control") ?? ""));

const login = await get("/login");
check("login page is public", login.status === 200, login.status);
check("clickjacking blocked", login.headers.get("x-frame-options") === "DENY");
check("nosniff set", login.headers.get("x-content-type-options") === "nosniff");
check(
  "framing denied by CSP",
  /frame-ancestors 'none'/.test(login.headers.get("content-security-policy") ?? ""),
);

for (const path of ["/", "/clients", "/reports", "/tasks", "/team", "/settings", "/integrations"]) {
  const r = await get(path);
  const to = r.headers.get("location") ?? "";
  check(
    `anonymous ${path} redirects to login`,
    r.status >= 300 && r.status < 400 && to.includes("/login"),
    `${r.status} ${to}`,
  );
}

for (const path of [
  "/api/attachments/does-not-exist",
  "/api/integrations/google/callback",
  "/api/integrations/gohighlevel/callback",
]) {
  const r = await get(path);
  check(
    `anonymous ${path} is refused`,
    [301, 302, 303, 307, 308, 401, 404].includes(r.status),
    r.status,
  );
}

const bogusUser = await get("/api/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://evil.example" },
  body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-123" }),
});
check("sign-in from a foreign origin is refused", bogusUser.status >= 400, bogusUser.status);

const signup = await get("/api/auth/sign-up/email", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "x@example.com", password: "a-long-password-1", name: "x" }),
});
check("public sign-up is disabled", signup.status >= 400, signup.status);

const missing = await get("/definitely/not/a/page");
check("unknown paths never answer 200", missing.status !== 200, missing.status);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed");
