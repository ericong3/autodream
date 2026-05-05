/**
 * Image URL helper — currently a passthrough.
 * Supabase image transforms (/render/image/public/) require Pro plan.
 * Width/quality params are accepted so call sites don't need to change
 * when transforms are enabled in the future.
 */
export function thumbUrl(
  url: string | null | undefined,
  _width: number,
  _quality = 72
): string | null {
  return url ?? null;
}
