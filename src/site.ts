/** Public address used on share cards, social previews and the static workout pages. */
export const DEFAULT_SITE_URL = 'https://summit-sykkel.vercel.app';

/** Short host for printing (no protocol, no trailing slash). */
export function siteHost(url: string = DEFAULT_SITE_URL): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
