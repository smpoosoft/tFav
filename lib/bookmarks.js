import { extractPathKey, cleanTitle } from './urlkit.js';
import { getItems, patchItem, upsertItem, generateId, setItems } from './storage.js';
import { upsertFavoriteCloud, deleteFavoriteCloud, upsertItemCloud } from './turso.js';

const BOOKMARKS_BAR_ID = '1';

export async function findOrCreateFolder(name) {
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0].children.find((n) => n.id === BOOKMARKS_BAR_ID) || tree[0].children[0];
  const existing = (bar.children || []).find((n) => n.title === name && (!('url' in n)));
  if (existing) return existing.id;
  const created = await chrome.bookmarks.create({ parentId: bar.id, title: name });
  return created.id;
}

export async function starItem(item, folderName) {
  if (item.starred && item.bookmarkIds?.length) {
    await upsertFavoriteCloud({
      id: item.id, itemId: item.id, pathKey: item.pathKey, title: item.title,
      titleClean: item.titleClean, url: item.urls?.[item.urls.length - 1]?.url || '',
      starredAt: item.lastStarredAt || 0, groupIds: item.groupIds || [], tagIds: item.tagIds || [],
    });
    return item;
  }
  const folderId = await findOrCreateFolder(folderName);
  const url = item.urls?.[item.urls.length - 1]?.url || item.originalUrl;
  if (!url) throw new Error('no url to star');
  const node = await chrome.bookmarks.create({ parentId: folderId, url, title: item.title });
  const patched = await patchItem(item.id, {
    starred: true,
    bookmarkIds: [node.id, ...(item.bookmarkIds || [])],
    lastStarredAt: Date.now(),
  });
  await upsertFavoriteCloud({
    id: item.id, itemId: item.id, pathKey: item.pathKey, title: item.title,
    titleClean: item.titleClean, url, starredAt: patched.lastStarredAt,
    groupIds: item.groupIds || [], tagIds: item.tagIds || [],
  });
  await upsertItemCloud(patched);
  return patched;
}

export async function unstarItem(item) {
  for (const bid of item.bookmarkIds || []) {
    try { await chrome.bookmarks.remove(bid); } catch {}
  }
  const patched = await patchItem(item.id, { starred: false, bookmarkIds: [], lastStarredAt: null });
  await deleteFavoriteCloud(item.id);
  await upsertItemCloud(patched);
  return patched;
}

export async function renameItem(item, title) {
  for (const bid of item.bookmarkIds || []) {
    try { await chrome.bookmarks.update(bid, { title }); } catch {}
  }
  return await patchItem(item.id, { title });
}

export async function moveItem(item, folderId) {
  for (const bid of item.bookmarkIds || []) {
    try { await chrome.bookmarks.move(bid, { parentId: folderId }); } catch {}
  }
  return item;
}

export async function removeBookmarkNode(bookmarkId) {
  try { await chrome.bookmarks.remove(bookmarkId); } catch {}
}

export async function listBookmarkFolders() {
  const tree = await chrome.bookmarks.getTree();
  const out = [];
  const walk = (nodes, path) => {
    for (const n of nodes) {
      if (!n.url) {
        out.push({ id: n.id, title: n.title || '/', path: path + (n.title || '/') });
        if (n.children) walk(n.children, path + (n.title || '/') + ' / ');
      }
    }
  };
  walk(tree, '');
  return out;
}

export async function analyzeDuplicateGroups() {
  const items = (await getItems()).filter((it) => it.starred);
  const groups = new Map();
  for (const it of items) {
    const key = (it.pathKey || extractPathKey(it.urls?.[0]?.url || '')).toLowerCase() + '\u0000' + (it.titleClean || cleanTitle(it.title || ''));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const dup = [];
  for (const arr of groups.values()) if (arr.length > 1) dup.push(arr);
  return dup;
}

export async function loadBookmarkNodes() {
  const tree = await chrome.bookmarks.getTree();
  const out = [];
  const walk = (nodes, parentIdPath) => {
    for (const n of nodes) {
      out.push({ id: n.id, url: n.url, title: n.title, dateAdded: n.dateAdded, parentId: n.parentId });
      if (n.children) walk(n.children, n.id);
    }
  };
  walk(tree, null);
  return out.filter((n) => n.url);
}

export async function syncBookmarksIntoItems() {
  const nodes = await loadBookmarkNodes();
  if (!nodes || nodes.length === 0) return;
  const items = await getItems();
  const now = Date.now();
  const idx = new Map();
  for (const it of items) {
    idx.set((it.pathKey || '').toLowerCase() + '\u0000' + (it.titleClean || ''), it);
  }
  const newItems = [];
  let changed = false;

  for (const n of nodes) {
    const pk = extractPathKey(n.url);
    const tc = cleanTitle(n.title || '');
    const key = pk.toLowerCase() + '\u0000' + tc;
    const it = idx.get(key);

    if (!it) {
      newItems.push({
        id: generateId(),
        pathKey: pk,
        title: n.title || n.url,
        titleClean: tc,
        urls: [{ url: n.url, collectedTimestamps: [n.dateAdded || now] }],
        collectedCount: 1,
        firstCollectedAt: n.dateAdded || now,
        lastCollectedAt: n.dateAdded || now,
        contentFingerprint: null,
        markdown: null,
        starred: true,
        bookmarkIds: [n.id],
        lastStarredAt: n.dateAdded || now,
        groupIds: [],
        tagIds: [],
      });
      changed = true;
    } else {
      const bids = it.bookmarkIds || [];
      if (!bids.includes(n.id)) {
        bids.push(n.id);
        it.bookmarkIds = bids;
        if (!it.starred) {
          it.starred = true;
          it.lastStarredAt = n.dateAdded || now;
        }
        changed = true;
      } else if (!it.starred) {
        it.starred = true;
        it.lastStarredAt = n.dateAdded || now;
        changed = true;
      }
    }
  }

  if (changed) {
    const all = items.concat(newItems);
    await setItems(all);
    for (const it of all.filter((x) => x.starred)) {
      await upsertFavoriteCloud({
        id: it.id, itemId: it.id, pathKey: it.pathKey, title: it.title,
        titleClean: it.titleClean, url: it.urls?.[it.urls.length - 1]?.url || '',
        starredAt: it.lastStarredAt || 0, groupIds: it.groupIds || [], tagIds: it.tagIds || [],
      });
    }
  }
}

export async function mergeDuplicateGroup(groupItems, keepId) {
  const keep = groupItems.find((it) => it.id === keepId);
  if (!keep) return;
  const groupIds = new Set(keep.groupIds || []);
  const tagIds = new Set(keep.tagIds || []);
  for (const it of groupItems) {
    if (it.id === keep.id) continue;
    for (const gid of it.groupIds || []) groupIds.add(gid);
    for (const tid of it.tagIds || []) tagIds.add(tid);
    for (const bid of it.bookmarkIds || []) {
      try { await chrome.bookmarks.remove(bid); } catch {}
    }
    await patchItem(it.id, { starred: false, bookmarkIds: [], lastStarredAt: null });
    await deleteFavoriteCloud(it.id);
  }
  const patched = await patchItem(keep.id, { groupIds: [...groupIds], tagIds: [...tagIds] });
  await upsertFavoriteCloud({
    id: patched.id, itemId: patched.id, pathKey: patched.pathKey, title: patched.title,
    titleClean: patched.titleClean, url: patched.urls?.[patched.urls.length - 1]?.url || '',
    starredAt: patched.lastStarredAt || 0, groupIds: patched.groupIds || [], tagIds: patched.tagIds || [],
  });
}
