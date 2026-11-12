import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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
  console.log(`✓ Checked ${files.length} dist files: links, assets, IDs, anchors, JSON-LD, and target security`);
}
