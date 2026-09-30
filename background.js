import { collectBatch } from './lib/dedupe.js';
import { getSettings, getSchemaVersion, setSchemaVersion, getItems, patchItem, upsertItem } from './lib/storage.js';
import {
  syncBookmarksIntoItems, starItem, unstarItem, renameItem, moveItem,
  removeBookmarkNode, analyzeDuplicateGroups, mergeDuplicateGroup
} from './lib/bookmarks.js';

chrome.runtime.onInstalled.addListener(async () => {
  let ver = await getSchemaVersion();
  if (ver === 0) { await setSchemaVersion(2); ver = 2; }
  if (ver < 2) await migrateToV2();
  await bootstrapBookmarkSync();
});

chrome.runtime.onStartup.addListener(async () => {
  await bootstrapBookmarkSync();
});

async function migrateToV2() {
  const items = await getItems();
  for (const it of items) {
    if (it.starred === undefined) {
      await patchItem(it.id, { starred: false, bookmarkIds: [], lastStarredAt: null });
    }
  }
  await setSchemaVersion(2);
}

async function bootstrapBookmarkSync() {
  try { await syncBookmarksIntoItems(); } catch (e) { console.warn('bookmark sync failed', e); }
  registerBookmarkListeners();
  registerBookmarkPolling();
}

let listenersRegistered = false;
function registerBookmarkListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  chrome.bookmarks.onCreated.addListener((id, bm) => onBookmarkCreated(id, bm));
  chrome.bookmarks.onChanged.addListener((id, info) => onBookmarkChanged(id, info));
  chrome.bookmarks.onMoved.addListener((id, info) => onBookmarkMoved(id, info));
  chrome.bookmarks.onRemoved.addListener((id) => onBookmarkRemoved(id));
}

async function onBookmarkCreated(id, bm) {
  if (!bm.url) return;
  const items = await getItems();
  const pk = extractPathKeySafe(bm.url);
  const tc = cleanTitleSafe(bm.title || '');
  let it = items.find((x) => (x.pathKey || '').toLowerCase() === pk.toLowerCase() && x.titleClean === tc);
  if (it) {
    const bids = it.bookmarkIds || [];
    if (!bids.includes(id)) bids.push(id);
    await patchItem(it.id, { starred: true, bookmarkIds: bids, lastStarredAt: Date.now() });
  } else {
    const now = Date.now();
    await upsertItem({
      id: cryptoRandomId(),
      pathKey: pk,
      title: bm.title || bm.url,
      titleClean: tc,
      urls: [{ url: bm.url, collectedTimestamps: [now] }],
      collectedCount: 1,
      firstCollectedAt: now,
      lastCollectedAt: now,
      contentFingerprint: null,
      markdown: null,
      starred: true,
      bookmarkIds: [id],
      lastStarredAt: now,
    });
  }
}

async function onBookmarkChanged(id, info) {
  const items = await getItems();
  for (const it of items) {
    if ((it.bookmarkIds || []).includes(id)) {
      const patch = {};
      if (info.title) { patch.title = info.title; patch.titleClean = cleanTitleSafe(info.title); }
      if (info.url) {
        patch.urls = [...(it.urls || []), { url: info.url, collectedTimestamps: [Date.now()] }];
        patch.pathKey = extractPathKeySafe(info.url);
      }
      await patchItem(it.id, patch);
    }
  }
}

async function onBookmarkMoved(id, info) {
  // moves don't affect url/title — item itself unchanged; UI ref reads tree when needed
}

async function onBookmarkRemoved(id) {
  const items = await getItems();
  for (const it of items) {
    if ((it.bookmarkIds || []).includes(id)) {
      const remaining = it.bookmarkIds.filter((b) => b !== id);
      if (remaining.length === 0) {
        await patchItem(it.id, { starred: false, bookmarkIds: [], lastStarredAt: null });
      } else {
        await patchItem(it.id, { bookmarkIds: remaining });
      }
    }
  }
}

function registerBookmarkPolling() {
  // SW may evict listeners; periodic re-sync compensates
  chrome.alarms?.create?.('tfav-sync', { periodInMinutes: 30 });
}

chrome.alarms?.onAlarm?.addListener?.((a) => {
  if (a.name === 'tfav-sync') syncBookmarksIntoItems();
});

function extractPathKeySafe(u) {
  try { return (new URL(u)).hostname.toLowerCase() + (new URL(u)).pathname.replace(/\/$/, ''); }
  catch { return u; }
}
function cleanTitleSafe(t) { return (t || '').replace(/[\s\u3000]+/g, ''); }
function cryptoRandomId() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  let id = ''; for (const v of b) id += v.toString(16).padStart(2, '0'); return id;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'sweep') {
    handleSweep(msg.closeTabs === true)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message || String(e) }));
    return true;
  }
  if (msg && msg.action === 'startup-sync') {
    bootstrapBookmarkSync()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg && msg.action === 'starItem') {
    starItemById(msg.itemId)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg && msg.action === 'unstarItem') {
    unstarItemById(msg.itemId)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg && msg.action === 'renameItem') {
    (async () => {
      const items = await getItems();
      const it = items.find((x) => x.id === msg.itemId);
      if (!it) return sendResponse({ error: 'not found' });
      await renameItem(it, msg.title);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'removeBookmark') {
    (async () => {
      await removeBookmarkNode(msg.bookmarkId);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'analyzeDuplicates') {
    analyzeDuplicateGroups()
      .then((groups) => sendResponse({ groups }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg && msg.action === 'mergeGroup') {
    (async () => {
      const items = await getItems();
      const group = items.filter((x) => msg.groupIds.includes(x.id));
      await mergeDuplicateGroup(group, msg.keepId);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

async function starItemById(itemId) {
  const items = await getItems();
  const it = items.find((x) => x.id === itemId);
  if (!it) throw new Error('not found');
  const s = await getSettings();
  return await starItem(it, s.bookmarkFolder || 'tFav');
}
async function unstarItemById(itemId) {
  const items = await getItems();
  const it = items.find((x) => x.id === itemId);
  if (!it) throw new Error('not found');
  return await unstarItem(it);
}

async function handleSweep(closeTabs) {
  const selfUrl = `chrome-extension://${chrome.runtime.id}/`;
  const settings = await getSettings();
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const now = Date.now();
  const collectable = allTabs.filter((t) => {
    if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('chrome-extension://')) return false;
    if (t.url.startsWith('devtools://')) return false;
    if (!settings.includePinned && t.pinned) return false;
    return true;
  });
  if (collectable.length === 0) return { keepCount: 0, closeCount: 0, dupCount: 0, message: '没有可收纳的标签页' };
  const result = await collectBatch(collectable, now);
  let closeCount = 0;
  if (closeTabs) {
    for (const t of collectable) {
      try { await chrome.tabs.remove(t.id); closeCount++; } catch {}
    }
  }
  return { keepCount: result.newCount, closeCount, dupCount: result.dupCount, total: result.total };
}