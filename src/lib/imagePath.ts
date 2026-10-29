const IMAGE_EXT =
  /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?)$/i;

/** True when `path` looks like a common image file. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}
