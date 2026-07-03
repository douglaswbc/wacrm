const fs = require("fs");
const path = require("path");

const openNextDir = ".open-next";
const assetsDir = path.join(openNextDir, "assets");

if (!fs.existsSync(openNextDir) || !fs.existsSync(assetsDir)) {
  console.error("Build output not found. Run 'opennextjs-cloudflare build' first.");
  process.exit(1);
}

// Copy all static assets from assets/ to the open-next root
// so Cloudflare Pages' env.ASSETS binding can serve them
for (const entry of fs.readdirSync(assetsDir)) {
  const src = path.join(assetsDir, entry);
  const dst = path.join(openNextDir, entry);
  // Skip directories that already exist in the root
  if (entry === "_worker.js") continue;
  if (fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dst, { recursive: true, force: true });
  } else if (!fs.existsSync(dst)) {
    fs.copyFileSync(src, dst);
  }
}

// Copy worker.js as _worker.js at the root for Cloudflare Pages
fs.copyFileSync(
  path.join(openNextDir, "worker.js"),
  path.join(openNextDir, "_worker.js")
);

console.log("Cloudflare Pages build ready at .open-next/");
