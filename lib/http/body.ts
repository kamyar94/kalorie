// Reading JSON request bodies in route handlers: size-limited, objects only.

/** The parsed body when it is a JSON object under the size limit, else null. */
export const readJsonObject = async (
  req: Request,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown> | null> => {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const optionalString = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;

export const optionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
