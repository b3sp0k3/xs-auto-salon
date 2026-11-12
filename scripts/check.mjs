import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("dist");
const errors = [];

const fail = (message) => errors.push(message);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }

  return files;
}

function isExternal(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value.trim());
}

function cleanUrl(value) {
  return value.trim().split(/[?#]/, 1)[0];
}

async function resolves(value, fromFile) {
  const url = cleanUrl(value);
  if (!url) return true;

  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }

  const candidate = url.startsWith("/")
    ? path.join(root, decoded.slice(1))
    : path.resolve(path.dirname(fromFile), decoded);

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return (await stat(path.join(candidate, "index.html"))).isFile();
    return info.isFile();
  } catch {
    return false;
  }
}

const files = await walk(root).catch(() => {
  fail("dist/ does not exist; run npm run build first");
  return [];
});

const htmlFiles = files.filter((file) => /\.html?$/i.test(file));
const cssFiles = files.filter((file) => /\.css$/i.test(file));
const ids = new Map();
const anchors = [];

for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(root, file);

  for (const match of source.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)) {
    const id = match[2];
    if (ids.has(id)) fail(`duplicate id "${id}" in ${relative} (also in ${ids.get(id)})`);
    else ids.set(id, relative);
  }

  for (const match of source.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
    const value = match[2];
    if (value.startsWith("#")) {
      anchors.push({ value: value.slice(1), file: relative });
    } else if (!isExternal(value) && !(await resolves(value, file))) {
      fail(`unresolved local ${match[0].match(/^(href|src)/i)[1]} "${value}" in ${relative}`);
    }
  }

  for (const tag of source.matchAll(/<[^>]+>/g)) {
    const markup = tag[0];
    const target = markup.match(/\btarget\s*=\s*(["'])_blank\1/i);
    if (target) {
      const rel = markup.match(/\brel\s*=\s*(["'])(.*?)\1/i);
      if (!rel || !/(?:^|\s)noopener(?:\s|$)/i.test(rel[2])) {
        fail(`target="_blank" without rel="noopener" in ${relative}: ${markup}`);
      }
    }
  }

  for (const json of source.matchAll(/<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(json[2]);
    } catch (error) {
      fail(`invalid JSON-LD in ${relative}: ${error.message}`);
    }
  }
}

for (const anchor of anchors) {
  if (!ids.has(anchor.value)) fail(`anchor "#${anchor.value}" has no target in ${anchor.file}`);
}

const page = await readFile(path.join(root, "index.html"), "utf8");
const requiredMarkup = [
  ["booking CTA opens the accessible request dialog", /<button class="btn btn-primary" type="button" data-open-appointment aria-haspopup="dialog">Book Your Detail<\/button>/],
  ["appointment dialog collects contact, vehicle, service, date, notes, and photos", /id="appointment-form"[\s\S]*?name="name"[\s\S]*?name="email"[\s\S]*?name="phone"[\s\S]*?name="vehicleType"[\s\S]*?name="service"[\s\S]*?name="preferredDate"[\s\S]*?name="notes"[\s\S]*?name="photos"/],
  ["appointment confirmation is clearly conditional", /appointment is not booked until X's Auto Salon confirms/],
  ["Facebook link targets the requested salon page safely", /<a class="contact-social" href="https:\/\/www\.facebook\.com\/p\/Xs-Auto-Salon-LLC-61588940095006\/" target="_blank" rel="noopener noreferrer"/],
  ["hero call CTA uses the business phone", /<a class="btn btn-outline" href="tel:4016991133"/],
  ["contact phone link is present", /href="tel:4016991133"/],
  ["contact email link is present", /href="mailto:xsautosalon@gmail\.com"/],
];
for (const [label, pattern] of requiredMarkup) {
  if (!pattern.test(page)) fail(`${label} is missing`);
}

const galleryCards = [...page.matchAll(/<div class="card-content">([\s\S]*?)<\/div>/g)];
if (galleryCards.length !== 3 || galleryCards.some(([, card]) => !/href="#services"/.test(card))) {
  fail("each of the three gallery cards must link to Services");
}

const iconFiles = [
  "hand-wash.svg", "interior.svg", "wax.svg", "buff.svg", "ceramic.svg", "sanding.svg", "wheels.svg", "extractor.svg",
  "target.svg", "medal.svg", "shield.svg", "expertise.svg", "reliable.svg",
];
for (const name of iconFiles) {
  const iconPath = path.join(root, "public/assets/icons", name);
  const icon = await readFile(iconPath, "utf8").catch(() => "");
  if (!/<svg\b[^>]*viewBox="0 0 24 24"/.test(icon) || !/stroke-width="1\.8"/.test(icon) || !/stroke-linecap="round"/.test(icon) || !/stroke-linejoin="round"/.test(icon)) {
    fail(`icon ${name} is missing the shared 24px red line-icon style`);
  }
}

const runtime = await readFile(path.join(root, "script.js"), "utf8");
class TestClassList {
  values = new Set();
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}
function testElement(href = null) {
  const attributes = new Map(href ? [["href", href]] : []);
  return {
    attributes,
    listeners: {},
    classList: new TestClassList(),
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    removeAttribute(name) { this.attributes.delete(name); },
    focus() { this.focused = true; },
  };
}
const menuToggle = testElement();
const navLinks = ["#home", "#services", "#gallery", "#contact"].map((href) => testElement(href));
const sections = ["home", "gallery", "services", "contact"].map((id) => ({ id }));
const bodyClasses = new TestClassList();
const documentListeners = {};
const observers = [];
class TestIntersectionObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
}
const appointmentDialog = testElement();
const appointmentForm = Object.assign(testElement(), { reportValidity: () => true, reset() {} });
const appointmentStatus = Object.assign(testElement(), { dataset: {} });
const appointmentFallback = testElement();
const appointmentSubmit = testElement();
const requestDate = testElement();
const documentMock = {
  body: { classList: bodyClasses },
  head: { append() {} },
  querySelector(selector) {
    if (selector === ".menu-toggle") return menuToggle;
    if (selector === "#appointment-dialog") return appointmentDialog;
    if (selector === "#appointment-form") return appointmentForm;
    if (selector === "#appointment-status") return appointmentStatus;
    if (selector === "#appointment-fallback") return appointmentFallback;
    if (selector === "#appointment-submit") return appointmentSubmit;
    if (selector === "#request-date") return requestDate;
    return testElement();
  },
  querySelectorAll(selector) {
    if (selector === ".primary-nav a") return navLinks;
    if (selector === ".section-anchor") return sections;
    if (selector === "[data-open-appointment]") return [];
    return [];
  },
  addEventListener(name, callback) { documentListeners[name] = callback; },
};
const mockFetch = async () => ({ ok: true, json: async () => ({ ready: false }) });
vm.runInNewContext(runtime, { document: documentMock, IntersectionObserver: TestIntersectionObserver, fetch: mockFetch });
menuToggle.listeners.click?.();
if (!bodyClasses.contains("nav-open") || menuToggle.getAttribute("aria-expanded") !== "true") fail("mobile menu does not open and announce its state");
navLinks[1].listeners.click?.();
if (bodyClasses.contains("nav-open") || menuToggle.getAttribute("aria-expanded") !== "false") fail("selecting a navigation link does not close the mobile menu");
menuToggle.listeners.click?.();
documentListeners.keydown?.({ key: "Escape" });
if (bodyClasses.contains("nav-open") || !menuToggle.focused) fail("Escape does not close the menu and return focus");
observers[0]?.callback([{ target: { id: "services" }, isIntersecting: true, intersectionRatio: 0.8 }]);
if (!navLinks[1].classList.contains("is-active") || navLinks[1].getAttribute("aria-current") !== "location") fail("current-section navigation state is not exposed accessibly");

for (const file of cssFiles) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const value = match[2].trim();
    if (!value || isExternal(value)) continue;
    if (!(await resolves(value, file))) fail(`unresolved CSS url() "${value}" in ${relative}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `✖ ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`✓ Checked ${files.length} dist files: links, assets, contact/booking paths, gallery routing, menu behavior, icons, JSON-LD, and target security`);
}
