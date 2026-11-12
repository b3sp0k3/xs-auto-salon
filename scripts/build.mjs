import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

// Source/unused images kept in the repo but not shipped to production.
const unshipped = new Set([
  "public/assets/landingpage-source.png",
  "public/assets/crops/detailer.png",
  "public/assets/crops/jetski.png"
]);

for (const path of ["index.html", "styles.css", "script.js", "robots.txt", "sitemap.xml", "llm.txt", "llms.txt", "public"]) {
  await cp(path, `dist/${path}`, {
    recursive: true,
    filter: (src) => !unshipped.has(src.split("\\").join("/"))
  });
}
