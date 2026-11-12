import assert from "node:assert/strict";
import handler from "../api/appointment-request.js";

const ENV_KEYS = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"];
const TEST_ENV = {
  RESEND_API_KEY: "test-only-resend-key",
  RESEND_FROM_EMAIL: "X's Auto Salon <appointments@example.test>",
  TURNSTILE_SITE_KEY: "test-only-public-site-key",
  TURNSTILE_SECRET_KEY: "test-only-turnstile-secret",
};
let checks = 0;

async function request({ method = "POST", body, env = TEST_ENV, network = {}, headers = {} } = {}) {
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const calls = [];
  for (const key of ENV_KEYS) {
    if (env[key]) process.env[key] = env[key];
    else delete process.env[key];
  }
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("challenges.cloudflare.com")) {
      return new Response(JSON.stringify(network.challenge ?? { success: true, hostname: "review.example" }), { status: network.challengeStatus ?? 200 });
    }
    if (String(url).includes("api.resend.com")) {
      if (network.onEmail) return network.onEmail(url, options);
      return new Response(JSON.stringify({ id: "mock-provider-acceptance-id" }), { status: 200 });
    }
    throw new Error("Unexpected external request in mocked API test");
  };

  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  const req = {
    method,
    headers: {
      host: "review.example",
      origin: "https://review.example",
      "content-type": "application/json",
      ...headers,
    },
    body,
  };

  try {
    await handler(req, response);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return { response, calls };
}

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

const unconfiguredEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, ""]));
const setup = await request({ method: "GET", env: unconfiguredEnv });
check(setup.response.statusCode === 200 && setup.response.body.ready === false, "unconfigured setup is reported unavailable");
check(!JSON.stringify(setup.response.body).includes("test-only"), "configuration probe does not reveal secrets");

const noConfigPost = await request({ body: {}, env: unconfiguredEnv });
check(noConfigPost.response.statusCode === 503 && noConfigPost.response.body.error === "not_configured", "requests cannot be accepted without service setup");

const badOrigin = await request({ body: {}, headers: { origin: "https://attacker.example" } });
check(badOrigin.response.statusCode === 403, "cross-origin form posts are rejected");

const missingContact = await request({ body: { name: "Test Driver", vehicleType: "Car", service: "Interior detailing" } });
check(missingContact.response.statusCode === 422 && missingContact.calls.length === 0, "contact details are required before spam checks or delivery");

const invalidDate = await request({ body: { name: "Test Driver", phone: "401-699-1133", vehicleType: "Car", service: "Interior detailing", preferredDate: "2026-02-31" } });
check(invalidDate.response.statusCode === 422, "invalid preferred dates are rejected");

const badPhoto = await request({ body: {
  name: "Test Driver", email: "driver@example.test", vehicleType: "Car", service: "Interior detailing",
  photos: [{ name: "not-an-image.png", type: "image/png", content: Buffer.from("not a png").toString("base64") }],
} });
check(badPhoto.response.statusCode === 422 && badPhoto.response.body.error === "invalid_photos", "photo MIME and file signatures are checked");

const blockedChallenge = await request({
  body: { name: "Test Driver", email: "driver@example.test", vehicleType: "Car", service: "Interior detailing", turnstileToken: "mock-token" },
  network: { challenge: { success: false, hostname: "review.example" } },
});
check(blockedChallenge.response.statusCode === 403 && !blockedChallenge.calls.some((call) => call.url.includes("api.resend.com")), "failed spam checks do not send email");

const accepted = await request({
  body: {
    name: "Test <Driver>", email: "driver@example.test", phone: "+1 401 555 0123",
    vehicleType: "Car", vehicleDetails: "2021 Example Coupe", service: "Interior detailing",
    preferredDate: "", notes: "Please assess <stains>.", turnstileToken: "mock-token", website: "",
    photos: [{
      name: "seat.png", type: "image/png",
      content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a4kAAAAASUVORK5CYII=",
    }],
  },
});
const emailCall = accepted.calls.find((call) => call.url.includes("api.resend.com"));
const emailBody = emailCall ? JSON.parse(emailCall.options.body) : null;
check(accepted.response.statusCode === 200 && accepted.response.body.ok === true, "a provider-accepted request returns success");
check(emailBody?.to?.[0] === "xsautosalon@gmail.com", "requests go to the exact salon inbox");
check(emailBody?.reply_to === "driver@example.test" && emailBody?.attachments?.length === 1, "reply address and optional photo attachment are included");
check(emailBody?.html.includes("Test &lt;Driver&gt;") && emailBody?.html.includes("&lt;stains&gt;"), "customer content is escaped in the email");
check(accepted.calls.filter((call) => call.url.startsWith("https://")).length === 2, "all outbound network calls were intercepted by the test mock");

const providerFailure = await request({
  body: { name: "Test Driver", email: "driver@example.test", vehicleType: "Car", service: "Interior detailing", turnstileToken: "mock-token" },
  network: { onEmail: async () => new Response(JSON.stringify({ error: "mock rejection" }), { status: 500 }) },
});
check(providerFailure.response.statusCode === 502 && providerFailure.response.body.ok === false, "provider rejection is reported as failure, not a false success");

console.log(`✓ Appointment API validation passed (${checks} checks); delivery network calls were mocked.`);
