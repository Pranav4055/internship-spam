// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractRichClipboardLinks } from './clipboardLinks.js';

describe('rich clipboard link metadata', () => {
  it('captures anchor text and the HTML-decoded destination without retaining the HTML', () => {
    const parsed = extractRichClipboardLinks(
      '<a href="https://forms.cloud.microsoft/r/eemriNec50?source=mail&amp;view=1">https://RegistrationPortal/dsu.edu.in</a>',
    );

    expect(parsed).toEqual({
      links: [{
        text: 'https://RegistrationPortal/dsu.edu.in',
        href: 'https://forms.cloud.microsoft/r/eemriNec50?source=mail&view=1',
      }],
      truncated: false,
    });
  });

  it('ignores markup that does not contain a text link with a destination', () => {
    expect(extractRichClipboardLinks('<p>Only plain text</p>')).toEqual({ links: [], truncated: false });
  });
});
