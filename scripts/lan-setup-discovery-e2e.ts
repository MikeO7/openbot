// Drives the local network announcement of a server with no account (issue #4178) on the real mDNS
// responder, and reads what it sends on the network. It checks the service type, the instance name
// and the TXT record, and that a sign-in sends the goodbye. No account or app is used.
// bun scripts/lan-setup-discovery-e2e.ts. Writes .openbot-build/lan-setup-discovery-e2e/report.json.
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DNSPacket } from "@homebridge/ciao/lib/coder/DNSPacket";
import { PTRRecord } from "@homebridge/ciao/lib/coder/records/PTRRecord";
import { TXTRecord } from "@homebridge/ciao/lib/coder/records/TXTRecord";
import { Effect } from "effect";
import { LAN_SETUP_SERVICE_TYPE, LanSetupAnnouncer } from "../src/main/lan-setup-announcer";

const OUT = resolve(import.meta.dirname, "../.openbot-build/lan-setup-discovery-e2e");
const MDNS_GROUP = "224.0.0.251";
const MDNS_PORT = 5353;
// RFC 1035 record types.
const PTR = 12;
const TXT = 16;
const SERVICE = `_${LAN_SETUP_SERVICE_TYPE}._tcp.local.`;
const SERVER_NAME = "e2e-server";
const DEADLINE_MS = 15_000;

interface Seen {
  type: number;
  name: string;
  ttl: number;
  value: string;
}

interface Report {
  passed: boolean;
  announced?: { instance: string; version: string | undefined; setup: string | undefined };
  goodbye?: { instance: string; ttl: number };
  announcedAgain?: { txt: string };
  messages: string[];
  failures: string[];
}

const seen: Seen[] = [];
const report: Report = { passed: false, messages: [], failures: [] };

/** The `key=value` entries of a TXT record, as the listener joins them with ";". */
function txtFields(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const entry of value.split(";")) {
    const separator = entry.indexOf("=");
    if (separator > 0) fields.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  return fields;
}

/** Waits until a record that the predicate accepts arrives, or fails at the deadline. */
async function waitFor(what: string, accept: (record: Seen) => boolean): Promise<Seen> {
  const started = Date.now();
  return await new Promise<Seen>((done, fail) => {
    const check = () => {
      const found = seen.find(accept);
      if (found) return done(found);
      if (Date.now() - started > DEADLINE_MS) return fail(new Error(`No mDNS record for: ${what}`));
      setTimeout(check, 50);
    };
    check();
  });
}

// A passive listener on the mDNS group, as a browsing app would hear the announcements.
const socket = createSocket({ type: "udp4", reuseAddr: true });
socket.on("message", (message, remote) => {
  try {
    const packet = DNSPacket.decode(remote, message);
    for (const record of [...packet.answers.values(), ...packet.additionals.values()]) {
      const value =
        record instanceof PTRRecord
          ? record.ptrName
          : record instanceof TXTRecord
            ? record.txt.map((entry) => entry.toString("utf8")).join(";")
            : "";
      seen.push({ type: record.type, name: record.name, ttl: record.ttl, value });
    }
  } catch {
    // Other mDNS traffic on the network can be in a form that this reader does not need.
  }
});
await new Promise<void>((done) =>
  socket.bind(MDNS_PORT, () => {
    socket.addMembership(MDNS_GROUP);
    done();
  }),
);

let signedOut = true;
const messages: string[] = [];
const announcer = new LanSetupAnnouncer({
  canBeSetUp: () => signedOut,
  serverName: () => SERVER_NAME,
  onInfo: (message) => messages.push(message),
  onError: (message, error) => messages.push(`${message} ${String(error)}`),
});

try {
  await Effect.runPromise(announcer.reconcile());
  const pointer = await waitFor(
    "the service pointer",
    (record) => record.type === PTR && record.name === SERVICE && record.ttl > 0,
  );
  assert.equal(pointer.value, `${SERVER_NAME}.${SERVICE}`, "The instance name is the server name.");
  const txt = await waitFor(
    "the TXT record",
    (record) => record.type === TXT && record.name === pointer.value && record.ttl > 0,
  );
  const fields = txtFields(txt.value);
  assert.equal(fields.get("version"), "1");
  assert.match(fields.get("setup") ?? "", /^[a-z2-7]{10}$/u, "The setup ID is 10 base32 characters.");
  assert.deepEqual([...fields.keys()].sort(), ["setup", "version"], "The TXT record has no other field.");
  report.announced = { instance: pointer.value, version: fields.get("version"), setup: fields.get("setup") };

  // A sign-in ends the announcement with a goodbye: the same pointer with TTL 0.
  signedOut = false;
  await Effect.runPromise(announcer.reconcile());
  const goodbye = await waitFor(
    "the goodbye",
    (record) => record.type === PTR && record.name === SERVICE && record.value === pointer.value && record.ttl === 0,
  );
  report.goodbye = { instance: goodbye.value, ttl: goodbye.ttl };

  // A second sign-out announces again with a new setup ID.
  const before = seen.length;
  signedOut = true;
  await Effect.runPromise(announcer.reconcile());
  const again = await waitFor(
    "the new TXT record",
    (record) => seen.indexOf(record) >= before && record.type === TXT && record.ttl > 0,
  );
  assert.notEqual(txtFields(again.value).get("setup"), fields.get("setup"), "A new announcement has a new setup ID.");
  report.announcedAgain = { txt: again.value };
  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await Effect.runPromise(announcer.close());
  socket.close();
  report.messages = messages;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"}. Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
