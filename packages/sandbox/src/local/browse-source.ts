/**
 * The program that runs inside the browser's container (A-R3-01). It is
 * written to the standard input of `node -`, after one line that defines
 * `REQUEST`, so neither it nor anything a scenario supplies is in an argument
 * (D-R3-05).
 *
 * Kept in a file of its own, with no import, so it can be read as the text it
 * is. `browseProgram` puts the strict-mode directive and `REQUEST` ahead of
 * it. `String.raw` passes every backslash through as written; the source
 * holds no backtick and no dollar-brace, which are the two things a raw
 * template would still read.
 *
 * What it does, and why it is shaped this way:
 *
 * - It starts two listeners on its own loopback that answer every request and
 *   every CONNECT with 403 and connect nowhere. Chrome's global proxy is one
 *   and the page's browser context has the other, and Chrome sends only
 *   loopback addresses direct. So nothing leaves the loopback by any scheme
 *   or initiator, and a host refused on the page's listener is one the page
 *   asked for (D-R3-04).
 * - It drives Chrome over a pipe. A debugging port on the loopback would be
 *   one the product could connect to (D-R3-05).
 * - It finds and reads elements in a script world of its own, where the
 *   page's scripts cannot replace what it reads, and asks Chrome's own
 *   accessibility tree for roles and names (D-R3-06).
 * - It observes and decides nothing. What it saw goes to stdout as JSON, and
 *   the comparison runs in the runtime's own process.
 */
export const BROWSE_SOURCE = String.raw`
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');

const STEP_MS = Number(process.env.BROWSE_STEP_MS);
const SETTLE_MS = Number(process.env.BROWSE_SETTLE_MS);
const QUIET_MS = Number(process.env.BROWSE_QUIET_MS);
// The one path a read-only container can write: Docker's own shared-memory mount.
const SCRATCH = '/dev/shm';

function fail(message) {
  process.stderr.write('browse: ' + message + '\n');
  process.exit(2);
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function norm(text) { return String(text).replace(/\s+/g, ' ').trim(); }
function parse(url) { try { return new URL(url); } catch (error) { return null; } }
function web(u) { return u !== null && (u.protocol === 'http:' || u.protocol === 'https:'); }

// The addresses Chrome sends direct whatever its proxy is.
function isLoopback(hostname) {
  const h = String(hostname).toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** A listener that refuses whatever it is asked for, counts the host, and connects nowhere. */
function refuser(counts) {
  function note(target) {
    const u = parse(target);
    const host = u === null || u.hostname === '' ? '(unreadable)' : u.hostname.toLowerCase();
    counts.set(host, (counts.get(host) || 0) + 1);
  }
  const server = http.createServer(function (req, res) {
    note(req.url);
    res.writeHead(403, { connection: 'close' });
    res.end();
  });
  server.on('connect', function (req, socket) {
    note('http://' + req.url);
    socket.on('error', function () {});
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () { resolve('http://127.0.0.1:' + server.address().port); });
  });
}

function accepts(host, port) {
  return new Promise(function (resolve) {
    const socket = net.connect({ host: host, port: port });
    socket.once('connect', function () { socket.destroy(); resolve(true); });
    socket.once('error', function () { socket.destroy(); resolve(false); });
  });
}
// Both loopback addresses are tried, as the probe does: a server told to listen on localhost binds whichever its resolver prefers.
async function ready(port, withinMs) {
  const deadline = Date.now() + withinMs;
  for (;;) {
    if (await accepts('127.0.0.1', port)) return '127.0.0.1';
    if (await accepts('::1', port)) return '[::1]';
    if (Date.now() >= deadline) return null;
    await sleep(100);
  }
}

// The four functions below run in the page, in a world of the runner's own.
const FIND = function (kind, wanted) {
  const norm = function (text) { return String(text).replace(/\s+/g, ' ').trim(); };
  if (kind === 'label') {
    const controls = [];
    for (const label of document.querySelectorAll('label')) {
      if (norm(label.innerText) === wanted && label.control && !controls.includes(label.control)) controls.push(label.control);
    }
    return controls;
  }
  const hits = [];
  for (const el of document.querySelectorAll('body, body *')) {
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
    if (typeof el.innerText === 'string' && norm(el.innerText) === wanted) hits.push(el);
  }
  // The innermost: an element is dropped when one inside it has the same text.
  return hits.filter(function (el) { return !hits.some(function (other) { return other !== el && el.contains(other); }); });
};
const DESCRIBE = function () {
  const norm = function (text) { return String(text).replace(/\s+/g, ' ').trim(); };
  const rect = this.getBoundingClientRect();
  const tag = this.tagName;
  const rendered = this.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  return {
    visible: rendered && rect.width > 0 && rect.height > 0,
    text: norm(typeof this.innerText === 'string' ? this.innerText : this.textContent),
    value: tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ? String(this.value) : null,
    tag: tag,
    type: tag === 'INPUT' ? String(this.type) : '',
    editable: this.isContentEditable === true,
  };
};
const CHOOSE = function (wanted) {
  const norm = function (text) { return String(text).replace(/\s+/g, ' ').trim(); };
  const options = Array.from(this.options).filter(function (option) { return norm(option.label) === wanted; });
  if (options.length !== 1) return 'it has ' + options.length + ' options shown as ' + JSON.stringify(wanted);
  if (this.value !== options[0].value) {
    this.value = options[0].value;
    this.dispatchEvent(new Event('input', { bubbles: true }));
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return '';
};
const QUIET = function (ms) {
  return new Promise(function (resolve) {
    if (document.readyState !== 'complete') { setTimeout(function () { resolve(false); }, 50); return; }
    const observer = new MutationObserver(function () { observer.disconnect(); clearTimeout(timer); resolve(false); });
    const timer = setTimeout(function () { observer.disconnect(); resolve(true); }, ms);
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
};
const NOT_TYPED = ['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'color', 'range', 'hidden'];

// Chrome's own traffic that starts inside a page's context without the page asking for it (D-R3-04).
const QUIETED = [
  'AutofillServerCommunication', 'NetworkTimeServiceQuerying', 'AimServerEligibilityEnabled', 'AimEnabled', 'AimServerRequestOnStartupEnabled',
  'OptimizationHints', 'OptimizationGuideModelDownloading', 'MediaRouter', 'Translate', 'CertificateTransparencyComponentUpdater',
  'SearchEnginePreconnect', 'SearchEnginePreconnect2', 'PreconnectToSearch',
];

function shown(target) {
  if (target.role !== undefined) return 'the ' + target.role + ' named ' + JSON.stringify(target.name);
  if (target.label !== undefined) return 'the field labelled ' + JSON.stringify(target.label);
  return 'the text ' + JSON.stringify(target.text);
}

async function main(request) {
  for (const n of [STEP_MS, SETTLE_MS, QUIET_MS]) if (!Number.isInteger(n) || n <= 0) fail('no step, settle, or quiet time');
  const started = Date.now();
  for (const dir of ['/tmp', '/home', '/profile']) fs.mkdirSync(SCRATCH + dir, { recursive: true });
  const refused = new Map();
  const forPage = await refuser(refused);
  const forBrowser = await refuser(new Map());

  const puppeteer = require(process.env.BROWSE_DRIVER);
  const browser = await puppeteer.launch({
    executablePath: process.env.BROWSE_CHROME,
    // A pipe, never a port: the product shares this network and could drive a browser that listened on it.
    pipe: true,
    headless: true,
    userDataDir: SCRATCH + '/profile',
    env: { PATH: process.env.PATH, HOME: SCRATCH + '/home', TMPDIR: SCRATCH + '/tmp', XDG_CONFIG_HOME: SCRATCH + '/home/.config', XDG_CACHE_HOME: SCRATCH + '/home/.cache' },
    args: [
      // Chrome's own sandbox cannot start under the container's limits, and the container is not widened for it (D-R3-03).
      '--no-sandbox',
      '--proxy-server=' + forBrowser,
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--no-pings', '--disable-domain-reliability', '--disable-client-side-phishing-detection',
      '--metrics-recording-only', '--disable-breakpad',
      '--disable-features=' + QUIETED.join(','),
    ],
  });
  const identity = String(await browser.version()).split('/');
  const result = { ready: false, observations: [], failedStep: null, blocked: [], browser: { name: identity[0], version: identity[1] || '' }, durationMs: 0 };

  const host = await ready(request.port, request.readyWithinMs);
  if (host !== null) {
    result.ready = true;
    const origin = 'http://' + host + ':' + request.port;
    // A context of its own: an empty profile, and a proxy only this page's traffic reaches.
    const context = await browser.createBrowserContext({ proxyServer: forPage });
    const page = await context.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    const frame = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;

    const inflight = new Set();
    const navigated = new Set();
    let interrupted = null;
    cdp.on('Network.requestWillBeSent', function (event) {
      inflight.add(event.requestId);
      const u = parse(event.request.url);
      if (web(u) && !isLoopback(u.hostname) && event.type === 'Document' && event.frameId === frame) navigated.add(u.hostname.toLowerCase());
    });
    cdp.on('Network.loadingFinished', function (event) { inflight.delete(event.requestId); });
    cdp.on('Network.loadingFailed', function (event) { inflight.delete(event.requestId); });
    cdp.on('Page.javascriptDialogOpening', function () {
      interrupted = 'the page opened a dialog, which a browser scenario does not answer';
      cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(function () {});
    });
    browser.on('targetcreated', function (target) {
      if (target.type() === 'page' && target !== page.target()) interrupted = 'the page opened another tab, which a browser scenario does not follow';
    });

    async function world() {
      return (await cdp.send('Page.createIsolatedWorld', { frameId: frame, worldName: 'browse' })).executionContextId;
    }
    async function evaluate(fn, args, byValue) {
      const expression = '(' + fn.toString() + ')(' + args.map(function (a) { return JSON.stringify(a); }).join(',') + ')';
      const answer = await cdp.send('Runtime.evaluate', { expression: expression, contextId: await world(), returnByValue: byValue, awaitPromise: true });
      if (answer.exceptionDetails) throw new Error('the page could not be read: ' + answer.exceptionDetails.text);
      return answer.result;
    }
    async function on(objectId, fn, args) {
      const answer = await cdp.send('Runtime.callFunctionOn', {
        objectId: objectId, functionDeclaration: fn.toString(), arguments: args.map(function (a) { return { value: a }; }), returnByValue: true,
      });
      if (answer.exceptionDetails) throw new Error('the element could not be read: ' + answer.exceptionDetails.text);
      return answer.result.value;
    }
    /** The elements a target names, as objects in the runner's own world. Chrome computes roles and names; the runner picks none. */
    async function find(target) {
      if (target.role !== undefined) {
        const context = await world();
        const root = (await cdp.send('Runtime.evaluate', { expression: 'document', contextId: context })).result.objectId;
        const wanted = norm(target.name);
        const query = wanted === '' ? { objectId: root, role: target.role } : { objectId: root, role: target.role, accessibleName: target.name };
        const nodes = (await cdp.send('Accessibility.queryAXTree', query)).nodes;
        const ids = [];
        for (const node of nodes) {
          if (node.ignored || node.backendDOMNodeId === undefined || ids.includes(node.backendDOMNodeId)) continue;
          // Checked here too, so an empty name means an element with no name and never any element of the role.
          if (norm(node.name && node.name.value !== undefined ? node.name.value : '') !== wanted) continue;
          ids.push(node.backendDOMNodeId);
        }
        const found = [];
        for (const id of ids) found.push((await cdp.send('DOM.resolveNode', { backendNodeId: id, executionContextId: context })).object.objectId);
        return found;
      }
      const kind = target.label !== undefined ? 'label' : 'text';
      const list = await evaluate(FIND, [kind, norm(kind === 'label' ? target.label : target.text)], false);
      const properties = (await cdp.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true })).result;
      return properties.filter(function (p) { return /^\d+$/.test(p.name) && p.value && p.value.objectId; }).map(function (p) { return p.value.objectId; });
    }
    /** Waits for the target to name exactly one visible element, and says why when it never does. */
    async function one(target) {
      const deadline = Date.now() + STEP_MS;
      for (;;) {
        let why;
        try {
          const found = await find(target);
          if (found.length === 1) {
            const seen = await on(found[0], DESCRIBE, []);
            if (seen.visible) return { objectId: found[0], seen: seen };
            why = shown(target) + ' is on the page and not visible';
          } else {
            why = found.length === 0 ? shown(target) + ' matched no element' : shown(target) + ' matched ' + found.length + ' elements, and none is picked';
          }
        } catch (error) {
          why = String(error && error.message || error);
        }
        if (Date.now() >= deadline) throw new Error(why);
        await sleep(100);
      }
    }
    /** Returns when no request is in flight and the document has stopped changing, or when SETTLE_MS has passed. */
    async function settle() {
      const deadline = Date.now() + SETTLE_MS;
      while (Date.now() < deadline) {
        if (inflight.size > 0) { await sleep(50); continue; }
        let quiet = false;
        try { quiet = (await evaluate(QUIET, [QUIET_MS], true)).value === true; } catch (error) { await sleep(50); }
        if (quiet && inflight.size === 0) return;
      }
    }
    // A click lands where a person's would: on whatever is at the middle of the element.
    async function click(objectId) {
      await cdp.send('DOM.scrollIntoViewIfNeeded', { objectId: objectId });
      const quads = (await cdp.send('DOM.getContentQuads', { objectId: objectId })).quads;
      if (quads.length === 0) throw new Error('the element has no area to click');
      const q = quads[0];
      await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4);
    }
    async function observe(target) {
      const found = await find(target);
      const seen = found.length === 1 ? await on(found[0], DESCRIBE, []) : { visible: false, text: '', value: null };
      const at = new URL(page.url());
      return { kind: 'observed', matched: found.length, visible: seen.visible, text: seen.text, value: seen.value, path: at.pathname + at.search, title: await page.title() };
    }
    async function perform(step) {
      if (step.do === 'goto') {
        // Joined as text, so the host is fixed before the path's first character whatever the path holds.
        const url = parse(origin + step.path);
        if (url === null || url.host !== new URL(origin).host) throw new Error('the path does not stay on the loopback');
        await page.goto(url.href, { waitUntil: 'load', timeout: STEP_MS });
      } else if (step.do === 'click') {
        await click((await one(step.target)).objectId);
      } else if (step.do === 'fill') {
        const field = await one(step.target);
        if (field.seen.tag === 'SELECT') {
          const refusal = await on(field.objectId, CHOOSE, [norm(step.value)]);
          if (refusal !== '') throw new Error(shown(step.target) + ' could not be set: ' + refusal);
        } else {
          const typed = field.seen.tag === 'TEXTAREA' || field.seen.editable || (field.seen.tag === 'INPUT' && !NOT_TYPED.includes(field.seen.type));
          if (!typed) throw new Error(shown(step.target) + ' is not a field that takes typed text');
          await click(field.objectId);
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await page.keyboard.type(step.value);
        }
      } else if (step.do === 'press') {
        await page.keyboard.press(step.key);
      } else {
        throw new Error('an unknown step: ' + JSON.stringify(step.do));
      }
    }
    /** Throws when the step left the page somewhere a scenario does not go. */
    function stayed() {
      if (interrupted !== null) throw new Error(interrupted);
      const at = parse(page.url());
      const here = web(at) && isLoopback(at.hostname);
      if (web(at) && !here) navigated.add(at.hostname.toLowerCase());
      if (navigated.size > 0) throw new Error('the page left the loopback for ' + [...navigated].sort().join(', '));
      if (!here) throw new Error('the page left the loopback and is at ' + String(page.url()).slice(0, 200));
    }

    for (let i = 0; i < request.steps.length; i += 1) {
      const step = request.steps[i];
      if (result.failedStep !== null) {
        if (step.do === 'observe') result.observations.push({ kind: 'not-reached', reason: 'step ' + result.failedStep.index + ' could not be done' });
        continue;
      }
      try {
        if (step.do === 'observe') {
          await settle();
          const seen = await observe(step.target);
          stayed();
          result.observations.push(seen);
        } else {
          await perform(step);
          await settle();
          stayed();
        }
      } catch (error) {
        result.failedStep = { index: i, reason: String(error && error.message || error) };
        if (step.do === 'observe') result.observations.push({ kind: 'not-reached', reason: 'step ' + i + ' could not be done' });
      }
    }
    const hosts = new Set([...refused.keys(), ...navigated]);
    result.blocked = [...hosts].sort().map(function (h) { return { host: h, requests: refused.get(h) || 0, navigation: navigated.has(h) }; });
  }
  result.durationMs = Date.now() - started;
  // The container ends with this process, and Chrome with it.
  process.stdout.write(JSON.stringify(result), function () { process.exit(0); });
}

let request;
try { request = JSON.parse(REQUEST); } catch (error) { fail('the request is not JSON'); }
main(request).catch(function (error) { fail(String(error && error.stack || error)); });
`;
