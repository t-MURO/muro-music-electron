import fs from "node:fs";
import path from "node:path";

export const SCROBBLE_SERVICES = ["lastfm", "listenbrainz"];

const emptyAccount = () => ({
  enabled: false,
  userName: null,
  /** Last.fm session key or ListenBrainz user token. Never leaves this module unencrypted. */
  secret: null,
  needsReconnect: false,
  reconnectReason: null,
});

/**
 * Scrobbling accounts, kept in the main process. Secrets are encrypted with
 * Electron safeStorage (DPAPI, Keychain, or the Linux secret store). Without a
 * real secret store they are held in memory only for this session, so the
 * user reconnects after a restart rather than having them written in clear.
 */
export const createCredentialStore = ({ filePath = null, safeStorage = null } = {}) => {
  let accounts = null;

  const canEncrypt = () => {
    try {
      if (!safeStorage?.isEncryptionAvailable?.()) return false;
      // Linux without a keyring falls back to a hard-coded key, which is no
      // better than plain text.
      return safeStorage.getSelectedStorageBackend?.() !== "basic_text";
    } catch {
      return false;
    }
  };

  const decrypt = (stored) => {
    if (typeof stored?.encrypted !== "string" || !canEncrypt()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored.encrypted, "base64")) || null;
    } catch {
      return null;
    }
  };

  const load = () => {
    if (accounts) return accounts;
    accounts = Object.fromEntries(SCROBBLE_SERVICES.map((service) => [service, emptyAccount()]));
    if (!filePath) return accounts;
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Ignoring unreadable scrobbling settings");
    }
    for (const service of SCROBBLE_SERVICES) {
      const entry = saved?.services?.[service];
      if (!entry || typeof entry !== "object") continue;
      const userName = typeof entry.userName === "string" && entry.userName ? entry.userName : null;
      const secret = decrypt(entry.secret);
      // An account whose secret could not be restored has to be connected again.
      const lostSecret = Boolean(userName && !secret);
      accounts[service] = {
        enabled: entry.enabled === true,
        userName,
        secret,
        needsReconnect: entry.needsReconnect === true || lostSecret,
        reconnectReason:
          typeof entry.reconnectReason === "string" && entry.reconnectReason
            ? entry.reconnectReason
            : lostSecret
              ? "The saved connection could not be restored"
              : null,
      };
    }
    return accounts;
  };

  const save = () => {
    if (!filePath) return;
    const encrypt = canEncrypt();
    const services = Object.fromEntries(
      SCROBBLE_SERVICES.map((service) => {
        const { secret, ...account } = accounts[service];
        return [
          service,
          {
            ...account,
            ...(secret && encrypt
              ? { secret: { encrypted: safeStorage.encryptString(secret).toString("base64") } }
              : {}),
          },
        ];
      }),
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, services }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  };

  return {
    get: (service) => ({ ...load()[service] }),
    update(service, patch) {
      const current = load()[service];
      if (!current) throw new Error(`Unknown scrobbling service: ${service}`);
      accounts[service] = { ...current, ...patch };
      try {
        save();
      } catch (error) {
        console.warn("Failed to save scrobbling settings:", error?.message ?? error);
      }
      return { ...accounts[service] };
    },
    /** "encrypted" when secrets survive a restart, "session" when they are memory-only. */
    storage: () => (filePath && canEncrypt() ? "encrypted" : "session"),
  };
};
