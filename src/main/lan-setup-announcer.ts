import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import ciao, { type CiaoService, type Responder } from "@homebridge/ciao";
import { Deferred, Effect } from "effect";

/**
 * Announces a server that has no account on the local network with DNS-SD (mDNS), so that the apps
 * can find it and offer to set it up (issue #4178). It announces only the server name and a random
 * setup ID: nothing that grants access. The announcement ends with a goodbye when the server signs
 * in, and when it stops.
 *
 * Docker passes multicast only with host networking, so the container turns this on only with
 * `OPENBOT_LAN_SETUP=1` (docs/docker.md).
 */
export const LAN_SETUP_SERVICE_TYPE = "openbot-setup";

/**
 * The port of the setup endpoint that a later change adds. A DNS-SD service needs a port in its SRV
 * record, so this one is reserved now; nothing listens on it yet.
 */
const LAN_SETUP_PORT = 41950;

/** The version of the announcement. An app ignores a version that it does not know. */
const LAN_SETUP_VERSION = "1";
const SETUP_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const SETUP_ID_LENGTH = 10;
/** A DNS label holds 63 bytes. */
const MAX_NAME_BYTES = 63;
const FALLBACK_NAME = "OpenBot";

export function lanSetupEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.OPENBOT_LAN_SETUP === "1";
}

export interface LanSetupAnnouncerOptions {
  /** True while the server has no account, which is the only time that it can be set up. */
  canBeSetUp: () => boolean;
  /** The name that the user gave the server, or `null` before it has one. */
  serverName: () => string | null;
  onInfo: (message: string) => void;
  onError: (message: string, error: unknown) => void;
  /** Tests only. */
  createResponder?: () => Responder;
}

export class LanSetupAnnouncer {
  readonly #options: LanSetupAnnouncerOptions;
  #responder: Responder | null = null;
  #service: CiaoService | null = null;
  #closed = false;
  #dirty = false;
  #running: Deferred.Deferred<void> | null = null;

  constructor(options: LanSetupAnnouncerOptions) {
    this.#options = options;
  }

  /**
   * Starts or ends the announcement to match the account state. Calls that come while one runs are
   * folded into one more pass, so the last state always wins.
   */
  reconcile(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#dirty = true;
      if (this.#running) return Deferred.await(this.#running);
      const running = Deferred.makeUnsafe<void>();
      this.#running = running;
      return this.#drainEffect().pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            this.#running = null;
            yield* Deferred.done(running, exit);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  /** Ends the announcement with a goodbye and closes the mDNS sockets. */
  close(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#closed = true;
      return this.reconcile();
    }).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          const responder = this.#responder;
          this.#responder = null;
          return responder
            ? this.#attempt("The local network announcement did not close.", () => responder.shutdown())
            : Effect.void;
        }),
      ),
    );
  }

  readonly #drainEffect = Effect.fn("LanSetupAnnouncer.drain")(function* (this: LanSetupAnnouncer) {
    while (this.#dirty) {
      this.#dirty = false;
      const wanted = !this.#closed && this.#options.canBeSetUp();
      if (wanted && !this.#service) yield* this.#announceEffect();
      else if (!wanted && this.#service) yield* this.#endEffect();
    }
  });

  readonly #announceEffect = Effect.fn("LanSetupAnnouncer.announce")(function* (this: LanSetupAnnouncer) {
    this.#responder ??= (this.#options.createResponder ?? (() => ciao.getResponder()))();
    const name = serviceName(this.#options.serverName());
    const service = this.#responder.createService({
      name,
      type: LAN_SETUP_SERVICE_TYPE,
      port: LAN_SETUP_PORT,
      txt: { version: LAN_SETUP_VERSION, setup: setupId() },
    });
    this.#service = service;
    const advertised = yield* this.#attempt("The local network announcement did not start.", () => service.advertise());
    if (!advertised) {
      this.#service = null;
      yield* this.#attempt("The local network announcement did not close.", () => service.destroy());
      return;
    }
    // The name can change when another device on the network uses it ("name (2)").
    this.#options.onInfo(`The server announces itself for setup on the local network as "${service.getFQDN()}".`);
  });

  readonly #endEffect = Effect.fn("LanSetupAnnouncer.end")(function* (this: LanSetupAnnouncer) {
    const service = this.#service;
    this.#service = null;
    if (!service) return;
    // `end` sends the goodbye, so the apps remove the server at once and not after the record TTL.
    yield* this.#attempt("The local network announcement did not end.", () => service.end());
    yield* this.#attempt("The local network announcement did not close.", () => service.destroy());
    this.#options.onInfo("The server no longer announces itself on the local network.");
  });

  /** Runs one step. A failure is logged and does not stop the server: the announcement is optional. */
  #attempt(message: string, step: () => Promise<void>): Effect.Effect<boolean> {
    return Effect.tryPromise({ try: step, catch: (cause) => cause }).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.sync(() => {
          this.#options.onError(message, cause);
          return false;
        }),
      ),
    );
  }
}

/** The server name as a DNS-SD instance name: no control characters, at most 63 bytes. */
function serviceName(name: string | null): string {
  const clean = (name ?? hostname()).replace(/\p{Cc}/gu, "").trim();
  let result = "";
  for (const character of clean) {
    if (Buffer.byteLength(result + character) > MAX_NAME_BYTES) break;
    result += character;
  }
  return result || FALLBACK_NAME;
}

function setupId(): string {
  return Array.from(randomBytes(SETUP_ID_LENGTH), (byte) => SETUP_ID_ALPHABET[byte % 32]).join("");
}
