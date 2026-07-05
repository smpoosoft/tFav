import { extractPathKey, cleanTitle, cleanUrl } from './urlkit.js';
import { getItems, upsertItem, upsertSession, generateId } from './storage.js';

export async function collectBatch(tabs, now) {
  const items = await getItems();
  const sessionResourceIds = [];
  let newCount = 0;
  let dupCount = 0;

  for (const tab of tabs) {
    const pathKey = extractPathKey(tab.url);
    const rawTitle = tab.title || '(无标题)';
    const titleClean = cleanTitle(rawTitle);
    const cleanedUrl = cleanUrl(tab.url);

    let existing = null;
    for (const it of items) {
      if (pathKey.toLowerCase() !== it.pathKey.toLowerCase()) continue;
      if (it.titleClean === titleClean) { existing = it; break; }
    }

    if (existing) {
      const urlEntry = existing.urls.find((u) => u.url === cleanedUrl);
      if (urlEntry) {
        urlEntry.collectedTimestamps.push(now);
      } else {
        existing.urls.push({ url: cleanedUrl, collectedTimestamps: [now] });
      }
      existing.collectedCount = existing.urls.reduce((s, u) => s + u.collectedTimestamps.length, 0);
      existing.lastCollectedAt = now;
      await upsertItem(existing);
      sessionResourceIds.push(existing.id);
      dupCount++;
    } else {
      const item = {
        id: generateId(),
        pathKey,
        title: rawTitle,
        titleClean,
        urls: [{ url: cleanedUrl, collectedTimestamps: [now] }],
        collectedCount: 1,
        firstCollectedAt: now,
        lastCollectedAt: now,
        contentFingerprint: null,
        markdown: null,
      };
      await upsertItem(item);
      sessionResourceIds.push(item.id);
      newCount++;
    }
  }

  const session = {
    id: generateId(),
    dateInBox: now,
    title: fmtTS(now),
    type: 'sweep',
    resourceIds: sessionResourceIds,
    locked: false,
  };
  await upsertSession(session);
  return { session, newCount, dupCount, total: tabs.length };
}

function fmtTS(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}_${p(d.getMonth()+1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
}
