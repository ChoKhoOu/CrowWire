const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
  'ref', '_ga', 'spm', 'scm',
]);

export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Lowercase host
    url.hostname = url.hostname.toLowerCase();
    // Remove tracking params
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }
    // Sort remaining params for consistency
    url.searchParams.sort();
    // Remove trailing slash from pathname (unless root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    // Remove fragment
    url.hash = '';
    return url.toString();
  } catch {
    // If URL parsing fails, return as-is
    return rawUrl;
  }
}
