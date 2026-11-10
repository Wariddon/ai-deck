const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const { BlockList, isIP } = require("node:net");

const privateV4 = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]]) privateV4.addSubnet(address, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16]]) specialV6.addSubnet(address, prefix, "ipv6");

const hostOf = (url) => url.hostname.replace(/^\[|\]$/gu, "");
const isLocal = (host) => ["localhost", "127.0.0.1", "::1"].includes(host);

function addressAllowed(address) {
  const family = isIP(address);
  if (family === 4) return !privateV4.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6");
}

function linkUrl(input) {
  if (typeof input !== "string" || input.length > 2000) throw new Error("Enter an HTTP or HTTPS URL.");
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a full URL starting with https:// or http://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Choose an HTTP or HTTPS URL without credentials.");
  }
  if (url.port && !isLocal(hostOf(url))) throw new Error("Custom ports are available for localhost previews.");
  url.hash = "";
  return url;
}

async function resolveTarget(url, localOrigin, lookup, signal) {
  const host = hostOf(url);
  if (isLocal(host)) {
    if (url.origin !== localOrigin) throw new Error("This link redirected to a local service. Enter the localhost URL directly.");
    return host === "::1" ? { address: "::1", family: 6 } : { address: "127.0.0.1", family: 4 };
  }
  const family = isIP(host);
  let candidates;
  if (family) candidates = [{ address: host, family }];
  else {
    const { promise, reject } = Promise.withResolvers();
    const abort = () => reject(signal.reason);
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    try { candidates = await Promise.race([promise, lookup(host, { all: true })]); }
    finally { signal.removeEventListener("abort", abort); }
  }
  const permitted = candidates.find(({ address }) => addressAllowed(address));
  if (!permitted) throw new Error("The link must be public or point directly to localhost.");
  return permitted;
}

function readPage(url, address, signal) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, {
      signal, agent: false, family: address.family,
      lookup: (_host, options, done) => options.all ? done(null, [address]) : done(null, address.address, address.family),
      headers: { Accept: "text/html, text/plain, application/json, text/markdown;q=0.9", "Accept-Encoding": "identity",
        "User-Agent": "AI Deck link preview" },
    }, (response) => {
      response.on("error", reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.destroy();
        return resolve({ redirect: response.headers.location });
      }
      const type = (response.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy();
        return reject(new Error("The page returned HTTP " + response.statusCode + "."));
      }
      if (!["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json"].includes(type) ||
          !["identity", undefined].includes(response.headers["content-encoding"])) {
        response.destroy();
        return reject(new Error("Choose a page that serves HTML, plain text, Markdown or JSON."));
      }
      const parts = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 512 * 1024) {
          response.destroy();
          reject(new Error("This page exceeds the 512 KB preview limit."));
        } else parts.push(chunk);
      });
      response.once("end", () => resolve({ html: ["text/html", "application/xhtml+xml"].includes(type),
        body: Buffer.concat(parts).toString("utf8").replaceAll("\0", "") }));
    });
    request.on("error", reject);
  });
}

async function previewLink(input, lookup = dns.lookup, signal = AbortSignal.timeout(12000)) {
  let url = linkUrl(input);
  const localOrigin = isLocal(hostOf(url)) ? url.origin : undefined;
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      signal.throwIfAborted();
      const address = await resolveTarget(url, localOrigin, lookup, signal);
      const result = await readPage(url, address, signal);
      if (!result.redirect) return { url: url.href, ...result };
      url = linkUrl(new URL(result.redirect, url).href);
      if (localOrigin && url.origin !== localOrigin) throw new Error("The localhost page redirected to a different origin.");
    }
  } catch (error) {
    if (signal.aborted) throw new Error("The link preview timed out.", { cause: error });
    throw error;
  }
  throw new Error("This link redirected too many times.");
}

module.exports = { previewLink, addressAllowed };
