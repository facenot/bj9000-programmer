// Build index.html: inline core.js into template.html (no channel data is embedded)
"use strict";
const fs = require("fs"), path = require("path");
const out = process.argv[2] || "index.html";
const core = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "template.html"), "utf8").replace("/*CORE*/", () => core);
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${html.length} bytes`);
