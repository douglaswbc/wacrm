import { describe, expect, it } from 'vitest';

import { substituteTemplateVars } from './send-message';

describe('substituteTemplateVars', () => {
  it('replaces {{1}} … {{n}} with positional params', () => {
    expect(
      substituteTemplateVars('Hi {{1}}, your order {{2}} shipped!', [
        'Jane',
        '#123',
      ]),
    ).toBe('Hi Jane, your order #123 shipped!');
  });

  it('pads missing params with "." like Meta does', () => {
    expect(substituteTemplateVars('Hello {{1}} and {{2}}', ['Jane'])).toBe(
      'Hello Jane and .',
    );
    expect(substituteTemplateVars('{{1}}/{{2}}/{{3}}', [])).toBe('././.');
  });

  it('ignores extra params', () => {
    expect(substituteTemplateVars('Hi {{1}}', ['A', 'B'])).toBe('Hi A');
  });

  it('leaves bodies without variables untouched', () => {
    expect(substituteTemplateVars('Plain message', ['a'])).toBe(
      'Plain message',
    );
  });

  it('handles multi-digit indexes', () => {
    const body = Array.from({ length: 12 }, (_, i) => `{{${i + 1}}}`).join(' ');
    const params = Array.from({ length: 12 }, (_, i) => String(i + 1));
    expect(substituteTemplateVars(body, params)).toBe(
      '1 2 3 4 5 6 7 8 9 10 11 12',
    );
  });
});
