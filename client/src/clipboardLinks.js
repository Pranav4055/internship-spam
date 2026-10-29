const MAX_LINKS = 40;
const MAX_LINK_METADATA_BYTES = 12 * 1024;
const MAX_LINK_FIELD_BYTES = 2048;

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function normalizeLinkText(value) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function extractRichClipboardLinks(html) {
  if (typeof html !== 'string' || !html) return { links: [], truncated: false };
  if (byteLength(html) > 512 * 1024) return { links: [], truncated: true };

  const document = new DOMParser().parseFromString(html, 'text/html');
  const links = [];
  let metadataBytes = 0;
  let truncated = false;

  for (const anchor of document.querySelectorAll('a[href]')) {
    const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
    const href = (anchor.getAttribute('href') ?? '').trim();
    if (!text || !href) continue;

    const linkBytes = byteLength(text) + byteLength(href);
    if (links.length >= MAX_LINKS || byteLength(text) > MAX_LINK_FIELD_BYTES || byteLength(href) > MAX_LINK_FIELD_BYTES
        || metadataBytes + linkBytes > MAX_LINK_METADATA_BYTES) {
      truncated = true;
      break;
    }
    links.push({ text, href });
    metadataBytes += linkBytes;
  }

  return { links, truncated };
}
