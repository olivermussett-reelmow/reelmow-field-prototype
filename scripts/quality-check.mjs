import fs from "node:fs";
import process from "node:process";

const failures = [];
const required = ["index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "icon.svg", ".github/workflows/pages.yml"];

for (const file of required) {
  if (!fs.existsSync(file)) failures.push(`Missing required file: ${file}`);
}

const app = fs.existsSync("app.js") ? fs.readFileSync("app.js", "utf8") : "";
const sw = fs.existsSync("sw.js") ? fs.readFileSync("sw.js", "utf8") : "";
const index = fs.existsSync("index.html") ? fs.readFileSync("index.html", "utf8") : "";

const mustContain = [
  ["Garage machine creation RPC", 'rpc("create_machine"'],
  ["Garage machine profile RPC", 'rpc("update_machine_profile"'],
  ["Catalogue identification matcher", "matchPlateIdentification"],
  ["Offline hours sync", 'rpc("sync_record_machine_hours"'],
  ["Offline service sync", 'rpc("sync_record_machine_service"'],
  ["Offline fault sync", 'rpc("sync_report_machine_fault"'],
  ["Controlled status transition", 'rpc("transition_machine_status"'],
  ["Controlled fault acknowledgement", 'rpc("acknowledge_machine_fault"'],
  ["Controlled fault resolution", 'rpc("resolve_machine_fault"'],
  ["Private evidence bucket", "reelmow-garage-private"]
];

for (const [label, token] of mustContain) {
  if (!app.includes(token)) failures.push(`Garage V1 contract missing: ${label}`);
}

const forbiddenDirectGarageWrites = [
  /schema\("garage"\)\.from\("machines"\)\.insert\(/,
  /schema\("garage"\)\.from\("machines"\)\.update\(/,
  /schema\("garage"\)\.from\("machines"\)\.delete\(/
];
for (const pattern of forbiddenDirectGarageWrites) {
  if (pattern.test(app)) failures.push(`Direct Garage machine mutation found in app.js: ${pattern}`);
}

if (!index.includes("reelmow.config.js")) failures.push("index.html does not load reelmow.config.js");
if (!index.includes("app.js")) failures.push("index.html does not load app.js");
if (!sw.includes('self.addEventListener("fetch"')) failures.push("Service worker fetch handler missing");

const actionRefs = new Set([...app.matchAll(/data-action=['"]([^'"]+)['"]/g)].map(m => m[1]));
const handlerRefs = new Set([...app.matchAll(/if\(x===["']([^"']+)["']\)/g)].map(m => m[1]));
for (const action of ["today", "garage", "catalogue", "activity", "profile", "back", "home"]) handlerRefs.add(action);
for (const action of ["service-task", "open-document", "open-service-evidence"]) handlerRefs.add(action);

for (const action of actionRefs) {
  if (!handlerRefs.has(action)) failures.push(`UI action has no static click handler: ${action}`);
}

const migrationsDir = "supabase/migrations";
if (fs.existsSync(migrationsDir)) {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql"));
  if (!files.length) failures.push("No Supabase migrations found");
  for (const file of files) {
    const text = fs.readFileSync(`${migrationsDir}/${file}`, "utf8");
    const definesSecurityDefinerFunction=/SECURITY DEFINER/i.test(text) && /(?:create|alter)\\s+(?:or\\s+replace\\s+)?function/i.test(text);
    if (definesSecurityDefinerFunction && !/set search_path\\s*(?:=|to)\\s*['"]{2}/i.test(text)) {
      failures.push(`SECURITY DEFINER function migration requires an empty search_path: ${file}`);
    }
  }
}

if (failures.length) {
  console.error("\nREELMOW quality gate failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("REELMOW quality gate passed.");
