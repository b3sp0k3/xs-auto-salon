const DESTINATION = "xsautosalon@gmail.com";
const MAX_BODY_BYTES = 3_500_000;
const MAX_PHOTO_BYTES = 1_048_576;
const MAX_TOTAL_PHOTO_BYTES = 2 * 1_048_576;
const MAX_PHOTOS = 3;
const ALLOWED_VEHICLES = new Set(["Car", "Truck or SUV", "Boat", "Jet ski", "Motorcycle", "Other"]);
const ALLOWED_SERVICES = new Set([
  "Exterior hand wash",
  "Interior detailing",
  "Wax & paint protection",
  "Buff & polish",
  "Ceramic coating",
  "Wet sanding",
  "Wheel & tire detailing",
  "Carpet & upholstery shampoo",
  "Marine detailing",
  "Motorcycle detailing",
  "Not sure — please advise",
]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export const config = { api: { bodyParser: { sizeLimit: "3.5mb" } } };

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function configured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.RESEND_FROM_EMAIL &&
    process.env.TURNSTILE_SITE_KEY &&
    process.env.TURNSTILE_SECRET_KEY,
  );
}

function parseBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function boundedText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const today = new Date().toISOString().slice(0, 10);
  return value >= today;
}

function hasValidImageSignature(buffer, mime) {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function normalizePhotos(value) {
  if (value === undefined || value === null) return { photos: [], error: "" };
  if (!Array.isArray(value) || value.length > MAX_PHOTOS) return { photos: [], error: "Add no more than three photos." };

  const photos = [];
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") return { photos: [], error: "One of the photos could not be read." };
    const mime = boundedText(item.type, 40).toLowerCase();
    const name = boundedText(item.name, 120).replace(/[^A-Za-z0-9._ -]/g, "_") || "vehicle-photo";
    const content = typeof item.content === "string" ? item.content : "";
    if (!ALLOWED_MIME.has(mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(content) || !content) {
      return { photos: [], error: "Use JPG, PNG, or WebP images only." };
    }
    const buffer = Buffer.from(content, "base64");
    if (!buffer.length || buffer.length > MAX_PHOTO_BYTES || buffer.toString("base64") !== content) {
      return { photos: [], error: "Each photo must be 1 MB or smaller." };
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_PHOTO_BYTES) return { photos: [], error: "Photos must total 2 MB or less." };
    if (!hasValidImageSignature(buffer, mime)) return { photos: [], error: "A photo's file content does not match its image type." };
    photos.push({ filename: name, content, content_type: mime });
  }
  return { photos, error: "" };
}

function getContactHost(req) {
  return String(req.headers.host || "").split(":")[0].toLowerCase();
}

async function verifyChallenge(token, req) {
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  const remoteIp = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { ok: false, unavailable: true };
  const result = await response.json().catch(() => null);
  const host = getContactHost(req);
  return {
    ok: Boolean(result?.success && (!host || result.hostname?.toLowerCase() === host)),
    unavailable: false,
  };
}

function emailContent(data) {
  const rows = [
    ["Name", data.name],
    ["Email", data.email || "Not provided"],
    ["Phone", data.phone || "Not provided"],
    ["Vehicle / watercraft", data.vehicleType],
    ["Year / make / model", data.vehicleDetails || "Not provided"],
    ["Requested service", data.service],
    ["Preferred date", data.preferredDate || "Flexible"],
    ["Notes", data.notes || "None"],
    ["Photos", data.photos.length ? `${data.photos.length} attached` : "None"],
  ];
  const html = [
    "<h2>New website appointment request</h2>",
    "<p><strong>Request only:</strong> no appointment has been confirmed. Please contact the customer to confirm availability.</p>",
    "<table cellpadding=\"6\" cellspacing=\"0\" style=\"border-collapse:collapse\">",
    ...rows.map(([label, value]) => `<tr><th align=\"left\" valign=\"top\">${escapeHtml(label)}</th><td>${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`),
    "</table>",
  ].join("");
  const text = [
    "New website appointment request",
    "Request only: no appointment has been confirmed. Please contact the customer to confirm availability.",
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
  return { html, text };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") {
    if (!configured()) return send(res, 200, { ready: false });
    return send(res, 200, { ready: true, siteKey: process.env.TURNSTILE_SITE_KEY });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const origin = req.headers.origin;
  const host = getContactHost(req);
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== String(req.headers.host || "").toLowerCase()) {
        return send(res, 403, { ok: false, error: "origin_not_allowed" });
      }
    } catch {
      return send(res, 403, { ok: false, error: "origin_not_allowed" });
    }
  }

  if (!configured()) return send(res, 503, { ok: false, error: "not_configured" });
  if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    return send(res, 415, { ok: false, error: "json_required" });
  }
  const length = Number(req.headers["content-length"] || 0);
  if (length > MAX_BODY_BYTES) return send(res, 413, { ok: false, error: "request_too_large" });

  const input = parseBody(req);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return send(res, 400, { ok: false, error: "invalid_request" });
  }
  if (boundedText(input.website, 200)) return send(res, 400, { ok: false, error: "invalid_request" });

  const data = {
    name: boundedText(input.name, 100),
    email: boundedText(input.email, 254).toLowerCase(),
    phone: boundedText(input.phone, 30),
    vehicleType: boundedText(input.vehicleType, 40),
    vehicleDetails: boundedText(input.vehicleDetails, 120),
    service: boundedText(input.service, 80),
    preferredDate: boundedText(input.preferredDate, 10),
    notes: boundedText(input.notes, 2000),
  };

  if (!data.name || (!data.email && !data.phone) || !data.vehicleType || !data.service) {
    return send(res, 422, { ok: false, error: "required_fields" });
  }
  if (data.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254)) {
    return send(res, 422, { ok: false, error: "invalid_email" });
  }
  const phoneDigits = data.phone.replace(/\D/g, "");
  if (data.phone && (!/^\+?[\d().\s-]{7,30}$/.test(data.phone) || phoneDigits.length < 7 || phoneDigits.length > 15)) {
    return send(res, 422, { ok: false, error: "invalid_phone" });
  }
  if (!ALLOWED_VEHICLES.has(data.vehicleType) || !ALLOWED_SERVICES.has(data.service) || !validDate(data.preferredDate)) {
    return send(res, 422, { ok: false, error: "invalid_selection" });
  }

  const photoResult = normalizePhotos(input.photos);
  if (photoResult.error) return send(res, 422, { ok: false, error: "invalid_photos", message: photoResult.error });
  data.photos = photoResult.photos;

  const token = boundedText(input.turnstileToken, 2048);
  if (!token) return send(res, 403, { ok: false, error: "captcha_required" });

  let challenge;
  try {
    challenge = await verifyChallenge(token, req);
  } catch {
    return send(res, 503, { ok: false, error: "spam_check_unavailable" });
  }
  if (challenge.unavailable) return send(res, 503, { ok: false, error: "spam_check_unavailable" });
  if (!challenge.ok) return send(res, 403, { ok: false, error: "captcha_invalid" });

  const message = emailContent(data);
  const mail = {
    from: process.env.RESEND_FROM_EMAIL,
    to: [DESTINATION],
    subject: `Website appointment request — ${data.name.replace(/[\r\n]+/g, " ").slice(0, 100)}`,
    text: message.text,
    html: message.html,
    ...(data.email ? { reply_to: data.email } : {}),
    ...(data.photos.length ? { attachments: data.photos } : {}),
  };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) {
      console.error("Appointment email provider rejected a request; status:", response.status);
      return send(res, 502, { ok: false, error: "delivery_failed" });
    }
    return send(res, 200, { ok: true });
  } catch {
    console.error("Appointment email provider could not be reached.");
    return send(res, 502, { ok: false, error: "delivery_failed" });
  }
}
