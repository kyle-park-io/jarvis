import { describe, it, expect } from 'vitest';
import { isExecutionAllowed } from './execution';

describe('isExecutionAllowed', () => {
  it('is true only for an exact repo match in the allowlist', () => {
    const allow = ['kyle-park-io/jarvis-sandbox'];
    expect(isExecutionAllowed('kyle-park-io/jarvis-sandbox', allow)).toBe(true);
    expect(isExecutionAllowed('kyle-park-io/jarvis', allow)).toBe(false);
    expect(isExecutionAllowed('other/jarvis-sandbox', allow)).toBe(false);
  });

  it('is false for an empty allowlist', () => {
    expect(isExecutionAllowed('a/b', [])).toBe(false);
  });
});
