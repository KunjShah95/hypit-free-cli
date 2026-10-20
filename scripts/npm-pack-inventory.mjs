/**
 * `npm pack --json` prints one array up to npm 11 and, from npm 12, one object keyed by package
 * name. Release tooling has to read both: maintainers run whichever npm they installed, while CI
 * pins its own, and a shape change must not decide whether a release can be packed.
 */
export function packInventory(output) {
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === "object") return Object.values(parsed);
  throw new Error(`npm pack --json returned neither an array nor an object: ${JSON.stringify(parsed)}`);
}
