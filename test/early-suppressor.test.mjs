import assert from "node:assert/strict";
import test from "node:test";

import { installEarlyQuotaSuppression } from "../src/cdp/early-suppressor.mjs";

const PORT = 55120;
const BROWSER_ID = "browser-early";
const BROWSER_URL = `ws://127.0.0.1:${PORT}/devtools/browser/${BROWSER_ID}`;

test("early suppression registers for future documents and evaluates in current app pages", async () => {
  const commands = [];
  const closed = [];
  const source = "globalThis.__EARLY_STRUCTURAL_STYLE__ = true";
  const targets = [
    { id: "main", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/main` },
    { id: "aux", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/aux` },
  ];
  const result = await installEarlyQuotaSuppression({
    engineRoot: "D:\\runtime",
    port: PORT,
    browserId: BROWSER_ID,
    browserWebSocketUrl: BROWSER_URL,
    targetSettleMs: 0,
    readSource: async (path, encoding) => {
      assert.match(path, /src[\\/]renderer[\\/]early-suppress\.js$/);
      assert.equal(encoding, "utf8");
      return source;
    },
    readIdentity: async () => ({ browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }),
    readTargets: async () => targets,
    createSession: (url, options) => ({
      async connect() { commands.push([url, "connect", options.port]); },
      async send(method, params) { commands.push([url, method, params]); return {}; },
      close() { closed.push(url); },
    }),
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.injected, 2);
  for (const target of targets) {
    const calls = commands.filter(([url]) => url === target.webSocketDebuggerUrl);
    assert.deepEqual(calls.map(([, method]) => method), [
      "connect",
      "Page.addScriptToEvaluateOnNewDocument",
      "Runtime.evaluate",
    ]);
    assert.match(calls[1][2].source, /Date\.now\(\) >= __codexQuotaEarlyDeadlineMs/);
    assert.match(calls[1][2].source, /__EARLY_STRUCTURAL_STYLE__/);
    assert.match(calls[2][2].expression, /__codexQuotaEarlyDeadlineMs/);
    assert.match(calls[2][2].expression, /__EARLY_STRUCTURAL_STYLE__/);
  }
  assert.deepEqual(closed.sort(), targets.map((target) => target.webSocketDebuggerUrl).sort());
});

test("early suppression refuses a changed browser identity before touching page targets", async () => {
  let targetsRead = false;
  await assert.rejects(
    installEarlyQuotaSuppression({
      engineRoot: "D:\\runtime",
      port: PORT,
      browserId: BROWSER_ID,
      browserWebSocketUrl: BROWSER_URL,
      readSource: async () => "void 0",
      readIdentity: async () => ({
        browserId: "browser-replaced",
        webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/browser/browser-replaced`,
      }),
      readTargets: async () => {
        targetsRead = true;
        return [];
      },
    }),
    /identity changed/i,
  );
  assert.equal(targetsRead, false);
});

test("one failed page remains isolated from successful early injections", async () => {
  const targets = [
    { id: "good", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/good` },
    { id: "bad", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/bad` },
  ];
  const result = await installEarlyQuotaSuppression({
    engineRoot: "D:\\runtime",
    port: PORT,
    browserId: BROWSER_ID,
    browserWebSocketUrl: BROWSER_URL,
    targetSettleMs: 0,
    readSource: async () => "void 0",
    readIdentity: async () => ({ browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }),
    readTargets: async () => targets,
    createSession: (url) => ({
      async connect() {
        if (url.endsWith("/bad")) throw new Error("closed");
      },
      async send() {},
      close() {},
    }),
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.injected, 1);
  assert.deepEqual(result.results.map(({ targetId, ok }) => ({ targetId, ok })), [
    { targetId: "good", ok: true },
    { targetId: "bad", ok: false },
  ]);
});

test("early suppression polls until the app page target appears", async () => {
  let targetReads = 0;
  let waits = 0;
  const result = await installEarlyQuotaSuppression({
    engineRoot: "D:\\runtime",
    port: PORT,
    browserId: BROWSER_ID,
    browserWebSocketUrl: BROWSER_URL,
    operationTimeoutMs: 500,
    targetPollMs: 1,
    targetSettleMs: 0,
    readSource: async () => "void 0",
    readIdentity: async () => ({ browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }),
    readTargets: async () => {
      targetReads += 1;
      return targetReads === 1
        ? []
        : [{ id: "late", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/late` }];
    },
    sleep: async (milliseconds) => {
      assert.equal(milliseconds, 1);
      waits += 1;
    },
    createSession: () => ({
      async connect() {},
      async send() {},
      close() {},
    }),
  });

  assert.equal(targetReads, 2);
  assert.equal(waits, 1);
  assert.equal(result.attempted, 1);
  assert.equal(result.injected, 1);
});

test("early suppression revalidates browser identity after target discovery", async () => {
  let identityReads = 0;
  let sessionCreated = false;
  await assert.rejects(
    installEarlyQuotaSuppression({
      engineRoot: "D:\\runtime",
      port: PORT,
      browserId: BROWSER_ID,
      browserWebSocketUrl: BROWSER_URL,
      targetSettleMs: 0,
      readSource: async () => "void 0",
      readIdentity: async () => {
        identityReads += 1;
        return identityReads === 1
          ? { browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }
          : {
            browserId: "browser-replaced",
            webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/browser/browser-replaced`,
          };
      },
      readTargets: async () => [
        { id: "main", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/main` },
      ],
      createSession: () => {
        sessionCreated = true;
        throw new Error("must not connect");
      },
    }),
    /identity changed/i,
  );
  assert.equal(identityReads, 2);
  assert.equal(sessionCreated, false);
});

test("early suppression keeps discovering when an auxiliary target appears before the main page", async () => {
  let clock = 0;
  let targetReads = 0;
  const evaluatedTargets = [];
  const aux = { id: "aux", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/aux` };
  const main = { id: "main", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/main` };
  const result = await installEarlyQuotaSuppression({
    engineRoot: "D:\\runtime",
    port: PORT,
    browserId: BROWSER_ID,
    browserWebSocketUrl: BROWSER_URL,
    operationTimeoutMs: 200,
    targetPollMs: 10,
    targetSettleMs: 30,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSource: async () => "globalThis.__EARLY_STRUCTURAL_STYLE__ = true",
    readIdentity: async () => ({ browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }),
    readTargets: async () => {
      targetReads += 1;
      return targetReads < 3 ? [aux] : [aux, main];
    },
    createSession: (url) => ({
      async connect() {},
      async send(method) {
        if (method === "Runtime.evaluate") evaluatedTargets.push(url);
      },
      close() {},
    }),
  });

  assert.ok(targetReads >= 3);
  assert.equal(result.attempted, 2);
  assert.equal(result.injected, 2);
  assert.deepEqual(evaluatedTargets.sort(), [aux.webSocketDebuggerUrl, main.webSocketDebuggerUrl].sort());
});

test("early suppression retries one transient page connection failure during settling", async () => {
  let clock = 0;
  let sessions = 0;
  const target = { id: "main", webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/main` };
  const result = await installEarlyQuotaSuppression({
    engineRoot: "D:\\runtime",
    port: PORT,
    browserId: BROWSER_ID,
    browserWebSocketUrl: BROWSER_URL,
    operationTimeoutMs: 100,
    targetPollMs: 10,
    targetSettleMs: 30,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    readSource: async () => "void 0",
    readIdentity: async () => ({ browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }),
    readTargets: async () => [target],
    createSession: () => {
      sessions += 1;
      const attempt = sessions;
      return {
        async connect() {
          if (attempt === 1) throw new Error("target still attaching");
        },
        async send() {},
        close() {},
      };
    },
  });

  assert.equal(sessions, 2);
  assert.equal(result.attempted, 2);
  assert.equal(result.injected, 1);
  assert.deepEqual(result.results.map(({ ok }) => ok), [false, true]);
});

test("early suppression preparation has a hard best-effort deadline", async () => {
  await assert.rejects(
    installEarlyQuotaSuppression({
      engineRoot: "D:\\runtime",
      port: PORT,
      browserId: BROWSER_ID,
      browserWebSocketUrl: BROWSER_URL,
      operationTimeoutMs: 20,
      readSource: async () => new Promise(() => {}),
      readIdentity: async () => ({ browserId: BROWSER_ID, webSocketDebuggerUrl: BROWSER_URL }),
    }),
    /preparation timed out/i,
  );
});
