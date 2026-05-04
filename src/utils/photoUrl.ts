/**
 * Converts a Supabase Storage public URL to a resized version via the
 * Supabase Image Transformation API (/render/image/public/).
 *
 * Use small widths for grid thumbnails, larger for detail views:
 *   thumbUrl(photo, 400)   — tiny avatar / list row thumb
 *   thumbUrl(photo, 640)   — grid card
 *   thumbUrl(photo, 900)   — detail page hero
 *   thumbUrl(photo, 1400)  — lightbox full view
 *
 * Non-Supabase URLs (avatars, external) are returned unchanged.
 */
export function thumbUrl(
  url: string | null | undefined,
  width: number,
  quality = 72
): string | null {
  if (!url) return null;
  const transformed = url.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/'
  );
  if (transformed === url) return url;
  return `${transformed}?width=${width}&quality=${quality}`;
}
