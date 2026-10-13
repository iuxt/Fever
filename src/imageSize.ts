// A trailing |number in an image label stores its width in CSS pixels.
export function parseImageAlt(value: string) {
 const match = /\|([1-9]\d*)$/.exec(value);
 const width = match ? Number(match[1]) : undefined;
 return width && Number.isSafeInteger(width)
  ? { alt: value.slice(0, match!.index), width }
  : { alt: value, width: undefined };
}

export function imageAltWithWidth(alt: string, width?: number | null) {
 const parsed = parseImageAlt(alt);
 const size = width ?? parsed.width;
 return size && Number.isSafeInteger(size) && size > 0 ? `${parsed.alt}|${size}` : parsed.alt;
}
