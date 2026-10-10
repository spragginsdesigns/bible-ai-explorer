import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
	OutboundUrlRefusedError,
	PUBLIC_WEB_POLICY,
	createGuardedLookup,
	isOutboundUrlAllowed,
	isPublicAddress,
	safeFetch,
} from "../src/lib/safe-fetch.ts";

test("public addresses pass and every non-global range is refused", () => {
	for (const address of [
		"8.8.8.8",
		"1.1.1.1",
		"151.101.1.69",
		"100.63.255.255",
		"100.128.0.0",
		"172.15.255.255",
		"172.32.0.0",
		"2606:4700:4700::1111",
		"2a00:1450:4001:82b::200e",
		"::ffff:8.8.8.8",
		"::ffff:0808:0808",
	]) {
		assert.equal(isPublicAddress(address), true, address);
	}

	for (const address of [
		"0.0.0.0",
		"0.1.2.3",
		"10.0.0.1",
		"100.64.0.1",
		"100.127.255.254",
		"127.0.0.1",
		"127.255.255.254",
		"169.254.169.254",
		"169.254.0.1",
		"172.16.0.1",
		"172.31.255.255",
		"192.0.0.8",
		"192.0.2.1",
		"192.88.99.1",
		"192.168.1.1",
		"198.18.0.1",
		"198.19.255.255",
		"198.51.100.7",
		"203.0.113.9",
		"224.0.0.1",
		"239.255.255.250",
		"240.0.0.1",
		"255.255.255.255",
		"::",
		"::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:169.254.169.254",
		"::ffff:10.0.0.1",
		"::127.0.0.1",
		"64:ff9b::a9fe:a9fe",
		"fc00::1",
		"fd12:3456:789a::1",
		"fe80::1",
		"fe80::1%eth0",
		"febf::1",
		"fec0::1",
		"ff02::1",
		"100::1",
		"2001::1",
		"2001:db8::1",
		"2002:7f00:1::1",
		"3fff::1",
		"not-an-ip",
		"1.2.3",
		"256.1.1.1",
		"1:2:3:4:5:6:7:8:9",
		"1::2::3",
	]) {
		assert.equal(isPublicAddress(address), false, address);
	}
});

test("the static URL policy refuses private literals, odd ports, credentials and local names", () => {
	for (const url of [
		"https://gracechapel.org/",
		"http://www.fmbcfresno.org/about",
		"http://gracechapel.org:80/",
		"https://gracechapel.org:443/",
		"http://gracechapel.org:443/",
		"http://8.8.8.8/",
		"http://[2606:4700:4700::1111]/",
	]) {
		assert.equal(isOutboundUrlAllowed(url), true, url);
	}

	for (const url of [
		"http://127.0.0.1/",
		"http://169.254.169.254/latest/meta-data/",
		"http://10.1.2.3/",
		"http://0.0.0.0/",
		// WHATWG URL folds these spellings to 127.0.0.1 before the check sees them.
		"http://2130706433/",
		"http://0x7f.1/",
		"http://017700000001/",
		"http://[::1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://[fd00::1]/",
		"http://[fe80::1]/",
		"http://localhost/",
		"http://LOCALHOST./",
		"http://api.localhost/",
		"http://printer.local/",
		"http://metadata.google.internal/",
		"http://router.home.arpa/",
		"http://intranet/",
		"https://gracechapel.org:8443/",
		"http://gracechapel.org:22/",
		"https://user:pass@gracechapel.org/",
		"ftp://gracechapel.org/",
		"file:///etc/passwd",
		"not a url",
	]) {
		assert.equal(isOutboundUrlAllowed(url), false, url);
	}
});

function lookupWith(policy, hostname, options) {
	return new Promise((resolve) => {
		createGuardedLookup(policy)(hostname, options, (err, address, family) => resolve({ err, address, family }));
	});
}

function resolverFor(records) {
	return async (hostname) => records[hostname] ?? [];
}

test("the socket lookup refuses a name if any address it resolves to is private", async () => {
	const policy = {
		...PUBLIC_WEB_POLICY,
		resolve: resolverFor({
			"public.test": [{ address: "93.184.215.14", family: 4 }, { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 }],
			"rebind.test": [{ address: "127.0.0.1", family: 4 }],
			"mixed.test": [{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }],
			"mapped.test": [{ address: "::ffff:169.254.169.254", family: 6 }],
		}),
	};

	const single = await lookupWith(policy, "public.test", {});
	assert.equal(single.err, null);
	assert.equal(single.address, "93.184.215.14");
	assert.equal(single.family, 4);

	const all = await lookupWith(policy, "public.test", { all: true });
	assert.equal(all.err, null);
	assert.equal(all.address.length, 2);

	const v6 = await lookupWith(policy, "public.test", { family: 6 });
	assert.equal(v6.family, 6);

	for (const hostname of ["rebind.test", "mixed.test", "mapped.test", "nxdomain.test"]) {
		const result = await lookupWith(policy, hostname, { all: true });
		assert.ok(result.err instanceof OutboundUrlRefusedError, hostname);
	}
});

/**
 * A local server stands in for the open web. Loopback is refused by the real
 * policy, so these tests allow exactly 127.0.0.1 on the server's port and map
 * test hostnames onto it; everything else is the production code path.
 */
async function withServer(handler, run) {
	const hits = [];
	const server = createServer((req, res) => {
		hits.push(`${req.headers.host}${req.url}`);
		handler(req, res);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	const policy = {
		isAllowedAddress: (address) => address === "127.0.0.1",
		allowedPorts: [port],
		resolve: resolverFor({
			"church.test": [{ address: "127.0.0.1", family: 4 }],
			"elsewhere.test": [{ address: "127.0.0.2", family: 4 }],
		}),
	};
	try {
		await run({ port, policy, hits });
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}

const BASE_OPTIONS = { timeoutMs: 3_000, maxBytes: 64 * 1024 };

test("a page is fetched, relative redirects are followed, and the final URL is reported", async () => {
	await withServer(
		(req, res) => {
			if (req.url === "/") {
				res.writeHead(301, { Location: "/home" });
				return res.end();
			}
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end("<title>Grace Chapel</title>");
		},
		async ({ port, policy, hits }) => {
			const response = await safeFetch(`http://church.test:${port}/`, { ...BASE_OPTIONS, policy });
			assert.equal(response.ok, true);
			assert.equal(response.url, `http://church.test:${port}/home`);
			assert.equal(new TextDecoder().decode(response.body), "<title>Grace Chapel</title>");
			assert.deepEqual(hits, [`church.test:${port}/`, `church.test:${port}/home`]);
		}
	);
});

test("a hostname that resolves to a refused address is never connected to", async () => {
	await withServer(
		(_req, res) => res.end("secret"),
		async ({ port, policy, hits }) => {
			// The production address policy, on the test server's port: church.test
			// resolves to 127.0.0.1, so the request must die in the lookup.
			const strict = { ...policy, isAllowedAddress: PUBLIC_WEB_POLICY.isAllowedAddress };
			await assert.rejects(
				safeFetch(`http://church.test:${port}/`, { ...BASE_OPTIONS, policy: strict }),
				OutboundUrlRefusedError
			);
			assert.deepEqual(hits, []);
		}
	);
});

test("every redirect hop is re-checked: metadata IPs, private names and odd ports are refused", async () => {
	for (const target of [
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://localhost/",
		"PORT_ELSEWHERE",
		"http://church.test:1/",
		"file:///etc/passwd",
	]) {
		await withServer(
			(req, res) => {
				const location = target === "PORT_ELSEWHERE" ? `http://elsewhere.test:${req.socket.localPort}/` : target;
				res.writeHead(302, { Location: location });
				res.end();
			},
			async ({ port, policy, hits }) => {
				await assert.rejects(
					safeFetch(`http://church.test:${port}/`, { ...BASE_OPTIONS, policy }),
					OutboundUrlRefusedError,
					target
				);
				assert.equal(hits.length, 1, target);
			}
		);
	}
});

test("redirect chains are capped", async () => {
	await withServer(
		(req, res) => {
			const n = Number(req.url.slice(1)) || 0;
			res.writeHead(302, { Location: `/${n + 1}` });
			res.end();
		},
		async ({ port, policy, hits }) => {
			await assert.rejects(
				safeFetch(`http://church.test:${port}/`, { ...BASE_OPTIONS, policy, maxRedirects: 3 }),
				OutboundUrlRefusedError
			);
			assert.equal(hits.length, 4);
		}
	);
});

test("bodies are capped, non-HTML is skipped unread, gzip is decoded, errors are returned", async () => {
	await withServer(
		(req, res) => {
			if (req.url === "/huge") {
				res.writeHead(200, { "Content-Type": "text/html" });
				return res.end("a".repeat(1024 * 1024));
			}
			if (req.url === "/pdf") {
				res.writeHead(200, { "Content-Type": "application/pdf" });
				return res.end("%PDF-1.7");
			}
			if (req.url === "/gzip") {
				res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
				return res.end(gzipSync("<p>Our mission</p>"));
			}
			res.writeHead(404, { "Content-Type": "text/html" });
			res.end("missing");
		},
		async ({ port, policy }) => {
			const base = `http://church.test:${port}`;
			const isHtml = (contentType) => /text\/html/.test(contentType);

			const huge = await safeFetch(`${base}/huge`, { ...BASE_OPTIONS, policy, maxBytes: 1000 });
			assert.equal(huge.body.byteLength, 1000);
			assert.equal(huge.truncated, true);

			const pdf = await safeFetch(`${base}/pdf`, { ...BASE_OPTIONS, policy, acceptContentType: isHtml });
			assert.equal(pdf.ok, true);
			assert.equal(pdf.body, null);

			const gzip = await safeFetch(`${base}/gzip`, { ...BASE_OPTIONS, policy });
			assert.equal(new TextDecoder().decode(gzip.body), "<p>Our mission</p>");

			const missing = await safeFetch(`${base}/missing`, { ...BASE_OPTIONS, policy });
			assert.equal(missing.ok, false);
			assert.equal(missing.status, 404);
			assert.equal(missing.body, null);
		}
	);
});

test("one deadline covers the whole request", async () => {
	await withServer(
		() => {
			// Never answers.
		},
		async ({ port, policy }) => {
			const started = Date.now();
			await assert.rejects(safeFetch(`http://church.test:${port}/`, { ...BASE_OPTIONS, policy, timeoutMs: 200 }));
			assert.ok(Date.now() - started < 2_000);
		}
	);
});
