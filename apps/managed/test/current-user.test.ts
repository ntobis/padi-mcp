import { afterEach, describe, expect, it } from 'vitest';

import { connectUrl } from '../lib/current-user';

const ORIGINAL = {
  APP_URL: process.env.APP_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
};

afterEach(() => {
  for (const key of Object.keys(ORIGINAL) as (keyof typeof ORIGINAL)[]) {
    const value = ORIGINAL[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('connectUrl', () => {
  it('prefers an explicit APP_URL', () => {
    process.env.APP_URL = 'https://padi.example.com/';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'padi-mcp-managed.vercel.app';
    expect(connectUrl()).toBe('https://padi.example.com/connect');
  });

  it('falls back to the Vercel production domain (never localhost in prod)', () => {
    Reflect.deleteProperty(process.env, 'APP_URL');
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'padi-mcp-managed.vercel.app';
    expect(connectUrl()).toBe('https://padi-mcp-managed.vercel.app/connect');
  });

  it('falls back to localhost only when nothing is configured', () => {
    Reflect.deleteProperty(process.env, 'APP_URL');
    Reflect.deleteProperty(process.env, 'VERCEL_PROJECT_PRODUCTION_URL');
    expect(connectUrl()).toBe('http://localhost:3000/connect');
  });
});
