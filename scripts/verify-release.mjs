import { readFile, readdir } from "node:fs/promises";

function requireContract(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const version = String(metadata.version);
  const expectedTag = process.env.RELEASE_TAG?.trim();

  requireContract(/^\d+\.\d+\.\d+$/.test(version), `Only stable MAJOR.MINOR.PATCH versions are supported: ${version}`);
  if (expectedTag) requireContract(expectedTag === `v${version}`, `Tag ${expectedTag} does not match package.json version ${version}`);
  requireContract(metadata.name === "@elonmark/codex-quota", `Unexpected npm package name: ${metadata.name}`);
  requireContract(JSON.stringify(metadata.os) === JSON.stringify(["win32"]), "The public package must support only win32");
  requireContract(JSON.stringify(metadata.cpu) === JSON.stringify(["x64"]), "The public package must support only x64");
  requireContract(
    JSON.stringify(metadata.bin) === JSON.stringify({ "codex-quota": "bin/codex-quota.mjs" }),
    "The package must expose only codex-quota -> bin/codex-quota.mjs"
  );
  requireContract(metadata.repository?.url === "git+https://github.com/keaipiao/codex-quota.git", `Unexpected repository URL: ${metadata.repository?.url}`);
  requireContract(metadata.publishConfig?.access === "public", "npm publish access must be public");
  requireContract(metadata.publishConfig?.provenance === true, "npm provenance must be enabled");
  requireContract(metadata.publishConfig?.registry === "https://registry.npmjs.org/", "npm registry must be the public registry");
  requireContract(metadata.files?.includes("README.zh-CN.md"), "The npm files allow-list must include README.zh-CN.md");

  const lockRoot = lock.packages?.[""];
  requireContract(lock.name === metadata.name && lock.version === version, "package-lock.json identity is out of sync");
  requireContract(lockRoot?.name === metadata.name && lockRoot?.version === version, "package-lock.json root package is out of sync");
  requireContract(
    JSON.stringify(lockRoot?.bin) === JSON.stringify(metadata.bin),
    "package-lock.json executable mapping is out of sync"
  );
  requireContract(
    JSON.stringify((await readdir(new URL("../bin/", import.meta.url))).sort()) === JSON.stringify(["codex-quota.mjs"]),
    "The shipped bin directory contains an unexpected entry"
  );

  process.stdout.write(`${version}\n`);
}

main().catch((error) => {
  process.stderr.write(`release contract: ${error.message}\n`);
  process.exitCode = 1;
});
