import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PACKAGE_ROOT } from "../src/paths.mjs";

test("release workflow enforces origin, package identity, and immutable reruns", async () => {
  const workflow = await readFile(join(PACKAGE_ROOT, ".github", "workflows", "release.yml"), "utf8");
  const releaseHelper = await readFile(join(PACKAGE_ROOT, ".github", "scripts", "reconcile-release.ps1"), "utf8");
  const contract = await readFile(join(PACKAGE_ROOT, "scripts", "verify-release.mjs"), "utf8");
  const releaseSources = `${workflow}\n${releaseHelper}\n${contract}`;

  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /group: release-\$\{\{ github\.repository \}\}/);
  assert.match(workflow, /git merge-base --is-ancestor \$env:GITHUB_SHA \$remoteRef/);
  assert.match(workflow, /node-version: "24\.18\.0"/);
  assert.match(workflow, /Expected npm 11\.16\.0/);
  assert.match(workflow, /node scripts\/verify-release\.mjs/);
  assert.match(contract, /\^\\d\+\\\.\\d\+\\\.\\d\+\$/);
  assert.match(contract, /@elonmark\/codex-quota/);
  assert.match(contract, /"codex-quota": "bin\/codex-quota\.mjs"/);
  assert.match(contract, /https:\/\/registry\.npmjs\.org\//);
  assert.ok(workflow.indexOf("prepare-github-release:") < workflow.indexOf("publish-npm:"));
  assert.match(workflow, /needs: \[build, prepare-github-release\]/);
  assert.match(releaseHelper, /--draft/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /Get-FileHash -LiteralPath \$archive -Algorithm SHA1/);
  assert.match(workflow, /\$Published\.dist\.integrity/);
  assert.match(workflow, /'dist-tags'\.latest/);
  assert.match(workflow, /attestations\.provenance\.predicateType/);
  assert.match(workflow, /npm already contains the complete verified publication/);
  assert.match(workflow, /Refusing to publish \$env:RELEASE_VERSION after npm latest/);
  assert.match(releaseHelper, /GitHub Release contains unexpected assets/);
  assert.match(releaseHelper, /Existing GitHub Release asset differs/);
  assert.match(releaseHelper, /leaving Latest unchanged/);
  assert.match(releaseHelper, /--latest=false/);
  assert.match(releaseHelper, /Could not determine the current GitHub Latest release/);
  assert.match(releaseHelper, /Existing published GitHub Release is not immutable/);
  assert.match(releaseHelper, /Published GitHub Release is not immutable/);
  assert.doesNotMatch(releaseSources, /--clobber/);
  assert.doesNotMatch(releaseSources, /NPM_TOKEN|NODE_AUTH_TOKEN/);
});
