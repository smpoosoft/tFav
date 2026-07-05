export const BLACKLIST_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'from', 'fromId', 'fromid', 'ref', 'referrer', 'referer',
  'share', 'shareId', 'shareid', 'shareFrom', 'sharefrom',
  'inviter', 'inviteCode', 'invitecode',
  'fbclid', 'gclid', 'msclkid', 'yclid', 'dclid', 'srsltid',
  'spm', 'scm', 'u', 'trace',
  'cu', 'pid',
  '_pdd', 'pdd_bid', 'pddBid',
  '_t', '_', 'nocache', 'ckey', 'cb',
  'feature', 'si',
  'test_id', 'variant', 'experiment', 'bucket', 'gtm_source',
  'theme', 'mobile',
  'source', 'medium', 'campaign',
  'tid', 't',
]);

const FULLWIDTH_MAP = {
  '（': '(', '）': ')', '，': ',', '！': '!', '？': '?',
  '：': ':', '；': ';', '【': '[', '】': ']', '《': '<', '》': '>',
  '＂': '"', '＇': "'", '＋': '+', '－': '-', '．': '.',
  '／': '/', '＝': '=', '＠': '@', '＾': '^', '＿': '_',
  '｀': '`', '｛': '{', '｜': '|', '｝': '}', '～': '~',
  '—': '-', '–': '-',
};

export function extractPathKey(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    return host + (path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path);
  } catch {
    return raw;
  }
}

export function cleanTitle(raw) {
  let s = raw;
  for (const [fw, hw] of Object.entries(FULLWIDTH_MAP)) {
    s = s.split(fw).join(hw);
  }
  s = s.replace(/\s+/g, '');
  return s;
}

export function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    const protocol = u.protocol === 'http:' ? 'https:' : u.protocol;
    const finalProtocol = protocol === 'https:' ? 'https:' : 'https:';
    const hostPort = (u.port && u.port !== '80' && u.port !== '443')
      ? `${host}:${u.port}` : host;
    const pathNorm = (path.endsWith('/') && path.length > 1) ? path.slice(0, -1) : path;
    const params = new URLSearchParams();
    let hasSurvivor = false;
    for (const [k, v] of u.searchParams) {
      if (!BLACKLIST_PARAMS.has(k)) {
        params.append(k, v);
        hasSurvivor = true;
      }
    }
    const qs = hasSurvivor ? '?' + params.toString() : '';
    return `${finalProtocol}//${hostPort}${pathNorm}${qs}`;
  } catch {
    return raw;
  }
}
