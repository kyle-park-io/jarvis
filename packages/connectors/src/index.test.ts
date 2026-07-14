import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('@jarvis/connectors', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
