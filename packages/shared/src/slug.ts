import { generateUID } from "./uid";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Slug with a short random suffix to dodge collisions without a DB round-trip. */
export function uniqueSlug(input: string): string {
  const base = slugify(input) || "untitled";
  return `${base}-${generateUID(6)}`;
}
