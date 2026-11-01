// JSON calls to Mealie and openGym: through the egress proxy (lib/net/egress.ts), with a timeout,
// no redirects (a redirect could lead anywhere), a size cap, and errors sorted into a few kinds
// the screens can explain. Tokens are sent only in the Authorization header and never logged.
import { egressFetch } from "@/lib/net/egress";

export type IntegrationErrorKind =
  /** The token or code was refused (401, 403). */
  | "auth"
  | "not_found"
  /** The server refused the request as invalid (400, 409, 422). */
  | "refused"
  /** Network, timeout, 429 or 5xx: try again later. */
  | "unavailable"
  /** Not JSON, too large or not the expected shape. */
  | "bad_reply"
  /** The address is not set on this server. */
  | "not_configured";

export class IntegrationError extends Error {
  readonly kind: IntegrationErrorKind;
  readonly status: number | null;
  constructor(kind: IntegrationErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "IntegrationError";
    this.kind = kind;
    this.status = status;
  }
}

export const isIntegrationError = (error: unknown): error is IntegrationError =>
  error instanceof IntegrationError;

/** Largest reply read (openGym's whole state can be a few megabytes). */
const MAX_REPLY_BYTES = 8 * 1024 * 1024;

export type CallOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
  /** Name of the service for messages ("Mealie", "openGym"). */
  service: string;
};

const readCapped = async (response: Response) => {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPLY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new IntegrationError("bad_reply", "The reply was too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/** A short reason from an error body ({detail}, {error}, {message}), never more than 160 chars. */
const reasonOf = (body: unknown) => {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.detail ?? record.error ?? record.message;
  if (typeof value === "string") return value.slice(0, 160);
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { message?: unknown }).message === "string"
  )
    return String((value as { message: string }).message).slice(0, 160);
  return null;
};

/** Calls url and returns the parsed JSON (null for an empty body). Throws IntegrationError. */
export const callJson = async <T = unknown>(url: string, options: CallOptions): Promise<T> => {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = (await egressFetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    })) as unknown as Response;
  } catch (error) {
    const timeout = (error as Error)?.name === "TimeoutError";
    throw new IntegrationError(
      "unavailable",
      timeout
        ? `${options.service} did not answer in time.`
        : `${options.service} cannot be reached right now.`,
    );
  }
  const status = response.status;
  const text = await readCapped(response).catch((error: unknown) => {
    if (isIntegrationError(error)) throw error;
    throw new IntegrationError("unavailable", `${options.service} stopped answering.`, status);
  });
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok)
        throw new IntegrationError(
          "bad_reply",
          `${options.service} sent a reply Cal cannot read.`,
          status,
        );
    }
  }
  if (response.ok) return body as T;
  const reason = reasonOf(body);
  if (status === 401 || status === 403)
    throw new IntegrationError("auth", `${options.service} did not accept Cal's sign-in.`, status);
  if (status === 404)
    throw new IntegrationError(
      "not_found",
      reason ?? `${options.service} has no such item.`,
      status,
    );
  if (status >= 300 && status < 400)
    throw new IntegrationError("bad_reply", `${options.service} answered with a redirect.`, status);
  if (status === 429 || status >= 500)
    throw new IntegrationError(
      "unavailable",
      `${options.service} is busy. Try again later.`,
      status,
    );
  throw new IntegrationError(
    "refused",
    reason ? `${options.service}: ${reason}` : `${options.service} refused the request.`,
    status,
  );
};
