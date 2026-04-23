import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const path of ["index.html", "styles.css", "script.js", "robots.txt", "sitemap.xml", "llm.txt", "llms.txt", "public"]) {
  await cp(path, `dist/${path}`, { recursive: true });
}
