// Uso: npm run release -- <patch|minor|major|x.y.z>
// Sube la versión en package.json y tauri.conf.json, hace commit, crea el tag y lo publica.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const arg = process.argv[2] || "patch";

if (execSync("git status --porcelain").toString().trim()) {
  console.error("Hay cambios sin commitear. Haz commit o stash antes de publicar.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const next =
  arg === "major" ? `${maj + 1}.0.0` :
  arg === "minor" ? `${maj}.${min + 1}.0` :
  arg === "patch" ? `${maj}.${min}.${pat + 1}` :
  /^\d+\.\d+\.\d+$/.test(arg) ? arg : null;
if (!next) { console.error(`Versión no válida: ${arg}`); process.exit(1); }

const bump = (file) => {
  const txt = readFileSync(file, "utf8");
  writeFileSync(file, txt.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
};
bump("package.json");
bump("src-tauri/tauri.conf.json");

console.log(`Publicando ${pkg.version} -> ${next}`);
run("git add package.json src-tauri/tauri.conf.json");
run(`git commit -m "Release v${next}"`);
run(`git tag v${next}`);
run("git push");
run(`git push origin v${next}`);
console.log(`Listo. GitHub Actions compilará y publicará v${next}.`);
