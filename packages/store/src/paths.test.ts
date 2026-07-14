import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataRoot, ensureDataRoot } from './paths';

describe('resolveDataRoot', () => {
  const saved = process.env.JARVIS_HOME;
  afterEach(() => {
    if (saved === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = saved;
  });

  it('prefers an explicit override', () => {
    process.env.JARVIS_HOME = '/from/env';
    expect(resolveDataRoot('/explicit')).toBe('/explicit');
  });

  it('falls back to JARVIS_HOME', () => {
    process.env.JARVIS_HOME = '/from/env';
    expect(resolveDataRoot()).toBe('/from/env');
  });

  it('defaults to ~/jarvis', () => {
    delete process.env.JARVIS_HOME;
    expect(resolveDataRoot()).toBe(path.join(os.homedir(), 'jarvis'));
  });
});

describe('ensureDataRoot', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-paths-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the root and plans/ directory idempotently', () => {
    const root = path.join(dir, 'data');
    ensureDataRoot(root);
    ensureDataRoot(root); // idempotent — must not throw
    expect(fs.existsSync(path.join(root, 'plans'))).toBe(true);
  });
});
