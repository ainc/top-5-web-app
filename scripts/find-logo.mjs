import { readFileSync } from "node:fs";

const html = readFileSync(process.env.TEMP + "/ainc.html", "utf8");
const names = [...html.matchAll(/ainc-logo[^"'\\\s]*/g)].map((match) => match[0]);
console.log([...new Set(names)].join("\n"));
