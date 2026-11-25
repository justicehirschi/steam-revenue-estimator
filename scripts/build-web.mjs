// Assembles the web (phone) version into _site/ for GitHub Pages. Run after `tsc` (see `npm run build:web`).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const OUT = "_site";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/web`, { recursive: true });

cpSync("dist", `${OUT}/dist`, { recursive: true });
cpSync("styles", `${OUT}/styles`, { recursive: true });
cpSync("web/storage.js", `${OUT}/web/storage.js`);
cpSync("web/config.js", `${OUT}/web/config.js`);
cpSync("web/index.html", `${OUT}/index.html`);

// The dashboard is the extension's own options page, with the localStorage stand-in for chrome.storage loaded first.
const firstScript = '<script src="dist/settings.js"></script>';
const options = readFileSync("options.html", "utf8");
if (!options.includes(firstScript)) {
    throw new Error(`options.html no longer contains ${firstScript}; update scripts/build-web.mjs.`);
}
writeFileSync(`${OUT}/options.html`, options.replace(firstScript, `<script src="web/storage.js"></script>\n    ${firstScript}`));

// Serve files as-is (no Jekyll processing).
writeFileSync(`${OUT}/.nojekyll`, "");
console.log(`Built the web version into ${OUT}/`);
