/**
 * Why a scrobbling request failed, which decides what happens to queued plays:
 *
 * - "retry": network trouble, timeouts, 5xx and rate limits. Kept and resent
 *   with backoff.
 * - "auth": the session key, token, API key or shared secret was refused.
 *   Sending pauses until the user reconnects.
 * - "rejected": the service will never accept this request. Queued plays are
 *   dropped and the reason recorded.
 */
export class ScrobbleRequestError extends Error {
  constructor(kind, message, { code = null, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "ScrobbleRequestError";
    this.kind = kind;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export const REQUEST_TIMEOUT_MS = 15_000;

export const timeoutSignal = (timeoutMs = REQUEST_TIMEOUT_MS) =>
  typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

/** A fetch() that threw never reached the service, so it is always retryable. */
export const networkError = (serviceName, error) => {
  const cause = error?.cause ?? error;
  const code = typeof cause?.code === "string" ? ` (${cause.code})` : "";
  const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
  return new ScrobbleRequestError(
    "retry",
    timedOut
      ? `${serviceName} did not respond in time`
      : `${serviceName} is unreachable${code}. Check your connection.`,
  );
};

const MUSICBRAINZ_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Services reject malformed MBIDs, so anything that is not a UUID is left out. */
export const musicBrainzIdOrNull = (value) => {
  const candidate = String(value ?? "").trim();
  return MUSICBRAINZ_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
};
