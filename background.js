import { collectBatch } from './lib/dedupe.js';
import { getSettings, getSchemaVersion, setSchemaVersion, getItems, patchItem, upsertItem,
         getGroups, upsertGroup, deleteGroup, getTags, upsertTag, deleteTag, generateId,
         getSessions, upsertSession, deleteSession } from './lib/storage.js';
import {
  syncBookmarksIntoItems, starItem, unstarItem, renameItem, moveItem,
  removeBookmarkNode, analyzeDuplicateGroups, mergeDuplicateGroup
} from './lib/bookmarks.js';
import { initSchema, upsertItemCloud, upsertSessionCloud, deleteSessionCloud,
         upsertFavoriteCloud, deleteFavoriteCloud,
         upsertGroupCloud, deleteGroupCloud, upsertTagCloud, deleteTagCloud } from './lib/turso.js';

chrome.runtime.onInstalled.addListener(async () => {
  let ver = await getSchemaVersion();
  if (ver === 0) { await setSchemaVersion(4); ver = 4; }
  if (ver < 2) await migrateToV2();
  if (ver < 3) await migrateToV3();
  if (ver < 4) await migrateToV4();
  await initSchema();
  await bootstrapBookmarkSync();
});

chrome.runtime.onStartup.addListener(async () => {
  await initSchema();
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

async function migrateToV3() {
  const items = await getItems();
  for (const it of items) {
    if (it.groupIds === undefined || it.tagIds === undefined) {
      await patchItem(it.id, { groupIds: it.groupIds || [], tagIds: it.tagIds || [] });
    }
  }
  await setSchemaVersion(3);
}

async function migrateToV4() {
  const allTags = await getTags();
  for (const tag of allTags) {
    if (tag.parentId === undefined) {
      await upsertTag({ ...tag, parentId: null });
    }
  }
  await setSchemaVersion(4);
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
    const patched = await patchItem(it.id, {
      starred: true, bookmarkIds: bids, lastStarredAt: Date.now(),
      groupIds: it.groupIds || [], tagIds: it.tagIds || [],
    });
    await upsertItemCloud(patched);
    await syncFavorite(patched.id);
  } else {
    const now = Date.now();
    const item = {
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
      groupIds: [],
      tagIds: [],
    };
    await upsertItem(item);
    await upsertItemCloud(item);
    await syncFavorite(item.id);
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
      const patched = await patchItem(it.id, patch);
      await upsertItemCloud(patched);
      await syncFavorite(patched.id);
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
        const patched = await patchItem(it.id, {
          starred: false, bookmarkIds: [], lastStarredAt: null,
        });
        await upsertItemCloud(patched);
        await deleteFavoriteCloud(patched.id);
      } else {
        const patched = await patchItem(it.id, { bookmarkIds: remaining });
        await upsertItemCloud(patched);
        await syncFavorite(patched.id);
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

chrome.storage.onChanged.addListener((changes) => {
  if (changes.tfav_settings) initSchema();
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
      await syncFavorite(it.id);
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
  // ---- 收纳组 ----
  if (msg && msg.action === 'updateSession') {
    (async () => {
      await upsertSession(msg.session);
      await upsertSessionCloud(msg.session);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'deleteSession') {
    (async () => {
      await deleteSession(msg.sessionId);
      await deleteSessionCloud(msg.sessionId);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'clearUnlockedSessions') {
    (async () => {
      const all = await getSessions();
      for (const sess of all.filter((s) => !s.locked)) {
        await deleteSession(sess.id);
        await deleteSessionCloud(sess.id);
      }
      sendResponse({ ok: true, deleted: all.filter((s) => !s.locked).length });
    })();
    return true;
  }
  // ---- 自定义分组 ----
  if (msg && msg.action === 'addGroup') {
    (async () => {
      const g = { id: generateId(), name: msg.name || '分组', createdAt: Date.now() };
      await upsertGroup(g);
      await upsertGroupCloud(g);
      sendResponse({ ok: true, group: g });
    })();
    return true;
  }
  if (msg && msg.action === 'renameGroup') {
    (async () => {
      const arr = await getGroups();
      const g = arr.find((x) => x.id === msg.groupId);
      if (g) { g.name = msg.name; await upsertGroup(g); await upsertGroupCloud(g); }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'removeGroup') {
    (async () => {
      await deleteGroup(msg.groupId);
      await deleteGroupCloud(msg.groupId);
      const items = await getItems();
      for (const it of items) {
        if ((it.groupIds || []).includes(msg.groupId)) {
          await patchItem(it.id, { groupIds: it.groupIds.filter((x) => x !== msg.groupId) });
          await syncFavorite(it.id);
        }
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  // ---- 标签 ----
  if (msg && msg.action === 'addTag') {
    (async () => {
      const t = {
        id: generateId(),
        name: msg.name || '标签',
        color: msg.color || '',
        parentId: msg.parentId || null,
        createdAt: Date.now(),
      };
      await upsertTag(t);
      await upsertTagCloud(t);
      sendResponse({ ok: true, tag: t });
    })();
    return true;
  }
  if (msg && msg.action === 'renameTag') {
    (async () => {
      const arr = await getTags();
      const t = arr.find((x) => x.id === msg.tagId);
      if (t) {
        if (msg.parentId !== undefined) {
          let cursor = arr.find((x) => x.id === msg.parentId);
          while (cursor) {
            if (cursor.id === t.id) return sendResponse({ error: 'invalid hierarchy' });
            cursor = cursor.parentId ? arr.find((x) => x.id === cursor.parentId) : null;
          }
        }
        t.name = msg.name;
        if (msg.color !== undefined) t.color = msg.color;
        if (msg.parentId !== undefined) t.parentId = msg.parentId || null;
        await upsertTag(t);
        await upsertTagCloud(t);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'moveTag') {
    (async () => {
      const arr = await getTags();
      const tag = arr.find((x) => x.id === msg.tagId);
      const parent = msg.parentId ? arr.find((x) => x.id === msg.parentId) : null;
      if (!tag || (msg.parentId && !parent)) return sendResponse({ error: 'not found' });

      let cursor = parent;
      while (cursor) {
        if (cursor.id === tag.id) return sendResponse({ error: 'invalid hierarchy' });
        cursor = cursor.parentId ? arr.find((x) => x.id === cursor.parentId) : null;
      }

      tag.parentId = parent?.id || null;
      await upsertTag(tag);
      await upsertTagCloud(tag);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'removeTag') {
    (async () => {
      const arr = await getTags();
      const target = arr.find((x) => x.id === msg.tagId);
      const parentId = target?.parentId || null;
      for (const tag of arr.filter((x) => x.parentId === msg.tagId)) {
        tag.parentId = parentId;
        await upsertTag(tag);
        await upsertTagCloud(tag);
      }
      await deleteTag(msg.tagId);
      await deleteTagCloud(msg.tagId);
      const items = await getItems();
      for (const it of items) {
        if ((it.tagIds || []).includes(msg.tagId)) {
          await patchItem(it.id, { tagIds: it.tagIds.filter((x) => x !== msg.tagId) });
          await syncFavorite(it.id);
        }
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  // ---- 条目分组 / 标签 ----
  if (msg && msg.action === 'assignItemGroup') {
    (async () => {
      const it = (await getItems()).find((x) => x.id === msg.itemId);
      if (it) {
        const g = new Set(it.groupIds || []);
        msg.add ? g.add(msg.groupId) : g.delete(msg.groupId);
        await patchItem(it.id, { groupIds: [...g] });
        await syncFavorite(it.id);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.action === 'assignItemTag') {
    (async () => {
      const it = (await getItems()).find((x) => x.id === msg.itemId);
      if (it) {
        const t = new Set(it.tagIds || []);
        msg.add ? t.add(msg.tagId) : t.delete(msg.tagId);
        await patchItem(it.id, { tagIds: [...t] });
        await syncFavorite(it.id);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

async function syncFavorite(itemId) {
  const it = (await getItems()).find((x) => x.id === itemId);
  if (!it || !it.starred) return;
  await upsertFavoriteCloud({
    id: it.id, itemId: it.id, pathKey: it.pathKey, title: it.title,
    titleClean: it.titleClean, url: it.urls?.[it.urls.length - 1]?.url || '',
    starredAt: it.lastStarredAt || 0, groupIds: it.groupIds || [], tagIds: it.tagIds || [],
  });
}

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
  await initSchema();
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
  // 收纳后自动写入收藏（浏览器书签 + favorites 云表），starItem 内部已按 pathKey+titleClean 去重
  const items = await getItems();
  for (const rid of result.session.resourceIds) {
    const it = items.find((x) => x.id === rid);
    if (!it) continue;
    try { await starItem(it, settings.bookmarkFolder || 'tFav'); }
    catch (e) { console.warn('auto-star failed', e); }
  }
  let closeCount = 0;
  if (closeTabs) {
    for (const t of collectable) {
      try { await chrome.tabs.remove(t.id); closeCount++; } catch {}
    }
  }
  return { keepCount: result.newCount, closeCount, dupCount: result.dupCount, total: result.total };
}
