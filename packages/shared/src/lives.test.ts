import { describe, expect, it } from 'vitest';
import { checkLiveLink, cleanShortText, LIVE_URL_MAX } from './lives';

describe('checkLiveLink', () => {
  it('accepts TikTok links and reads the account', () => {
    expect(checkLiveLink('https://www.tiktok.com/@afimode/live')).toEqual({
      ok: true,
      url: 'https://www.tiktok.com/@afimode/live',
      platform: 'TIKTOK',
      account: '@afimode',
    });
    expect(checkLiveLink('https://vm.tiktok.com/ZMabc123/')).toMatchObject({
      ok: true,
      platform: 'TIKTOK',
      account: null,
    });
  });

  it('accepts Facebook links, keeps the query and reads the page name', () => {
    expect(checkLiveLink('https://www.facebook.com/kofielectro/videos/123456')).toMatchObject({
      ok: true,
      platform: 'FACEBOOK',
      account: 'kofielectro',
    });
    expect(checkLiveLink('https://www.facebook.com/watch/live/?v=987')).toEqual({
      ok: true,
      url: 'https://www.facebook.com/watch/live/?v=987',
      platform: 'FACEBOOK',
      account: null,
    });
    expect(checkLiveLink('https://fb.watch/abcDEF/')).toMatchObject({ ok: true, account: null });
  });

  it('adds https when it is missing, upgrades http and drops the fragment', () => {
    expect(checkLiveLink('  tiktok.com/@pagnes.dede/live  ')).toMatchObject({
      ok: true,
      url: 'https://tiktok.com/@pagnes.dede/live',
    });
    expect(checkLiveLink('http://m.facebook.com/awa#top')).toMatchObject({
      ok: true,
      url: 'https://m.facebook.com/awa',
    });
    expect(checkLiveLink('HTTPS://WWW.TIKTOK.COM/@Afi')).toMatchObject({
      ok: true,
      url: 'https://www.tiktok.com/@Afi',
    });
  });

  it('refuses other sites, look-alike hosts and dangerous forms', () => {
    for (const link of [
      'https://youtube.com/live/abc',
      'https://tiktok.com.evil.example/@x',
      'https://evil.example/?https://tiktok.com',
      'https://faceb00k.com/x',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://tiktok.com/@x',
      'https://user:pass@tiktok.com/@x',
      'https://tiktok.com:8080/@x',
    ]) {
      expect(checkLiveLink(link)).toEqual({ ok: false, error: 'NOT_ALLOWED' });
    }
  });

  it('refuses empty, malformed and over-long links', () => {
    expect(checkLiveLink('   ')).toEqual({ ok: false, error: 'EMPTY' });
    expect(checkLiveLink('tiktok .com/@x')).toEqual({ ok: false, error: 'INVALID' });
    expect(checkLiveLink(`https://tiktok.com/@x/${'a'.repeat(LIVE_URL_MAX)}`)).toEqual({
      ok: false,
      error: 'TOO_LONG',
    });
  });
});

describe('cleanShortText', () => {
  it('collapses spaces and removes invisible and control characters', () => {
    expect(cleanShortText('  Afi \n\t Mode  ')).toBe('Afi Mode');
    expect(cleanShortText('Pa​gnes‮ Dédé\u0007')).toBe('Pagnes Dédé');
    expect(cleanShortText('Café')).toBe('Café');
  });
});
