import { describe, it, expect } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { buildConsentUrl, CALENDAR_SCOPES } from './auth-command';

describe('buildConsentUrl', () => {
  it('requests offline access + consent + the calendar scope', () => {
    const client = new OAuth2Client({ clientId: 'i', clientSecret: 's', redirectUri: 'http://localhost:9/x' });
    const url = new URL(buildConsentUrl(client, CALENDAR_SCOPES));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:9/x');
  });
});
