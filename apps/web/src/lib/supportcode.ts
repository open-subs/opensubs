// The error code a "having trouble?" message carries. Kept apart from
// support.ts so the views can name a failure without loading the box — the
// phone shells render these same views and never load it.

/**
 * A code the server will keep: letters, digits and `_.:/-`, at most 80.
 * From an error's name, never its message, which can carry a file name.
 */
export function supportCode(prefix: string, error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error && typeof error.name === "string"
      ? error.name
      : "";
  const raw = name && name !== "Error" ? `${prefix}:${name}` : prefix;
  return raw.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 80);
}
