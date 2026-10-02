// Turso (libsql) HTTP API 封装。URL/token 从设置读，未配置时静默跳过。
// 源码中禁止硬编码凭据，开发调试用 .env（已 gitignore），用户在设置页自配。
//
// 表结构：收纳与收藏是两张独立表。
//   sessions   收纳组（一次收纳 = 一行）
//   items      收纳条目（一条 = 一个唯一内容原子）
//   favorites  收藏条目（独立于收纳，star 后写入）
//   tfav_groups 自定义分组
//   tfav_tags   标签

async function getTursoConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get('tfav_settings', (r) => {
      const s = r.tfav_settings || {};
      if (s.tursoUrl && s.tursoToken) {
        const url = s.tursoUrl.trim()
          .replace(/^libsql:\/\//i, 'https://')
          .replace(/\/$/, '');
        resolve({ url, token: s.tursoToken.trim() });
      } else {
        resolve(null);
      }
    });
  });
}

function stmt(sql, args = []) {
  const mapArg = (v) => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'number') {
      return { type: Number.isInteger(v) ? 'integer' : 'float', value: String(v) };
    }
    return { type: 'text', value: String(v) };
  };
  return { type: 'execute', stmt: { sql, args: args.map(mapArg) } };
}

async function execute(stmts) {
  const cfg = await getTursoConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/v3/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [...stmts, { type: 'close' }] }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    throw new Error(`turso http ${res.status}: ${data?.error || text.slice(0, 200)}`);
  }
  const err = data.results?.find((r) => r.type === 'error');
  if (err) throw new Error(err.error?.message || 'turso error');
  return data;
}

export async function initSchema() {
  try {
    await execute([
      stmt(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, dateInBox INTEGER, title TEXT,
        type TEXT, resourceIds TEXT, locked INTEGER)`),
      stmt(`CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY, pathKey TEXT, title TEXT, titleClean TEXT,
        urls TEXT, collectedCount INTEGER, firstCollectedAt INTEGER,
        lastCollectedAt INTEGER, starred INTEGER, bookmarkIds TEXT, lastStarredAt INTEGER)`),
      stmt(`CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY, itemId TEXT, pathKey TEXT, title TEXT, titleClean TEXT,
        url TEXT, starredAt INTEGER, groupIds TEXT, tagIds TEXT)`),
      stmt(`CREATE TABLE IF NOT EXISTS tfav_groups (
        id TEXT PRIMARY KEY, name TEXT, createdAt INTEGER)`),
      stmt(`CREATE TABLE IF NOT EXISTS tfav_tags (
        id TEXT PRIMARY KEY, name TEXT, color TEXT, parentId TEXT, createdAt INTEGER)`),
    ]);
    // 兼容 v0.3.0 期间已创建的 tfav_tags 表；重复执行时报 duplicate column 可忽略。
    try {
      await execute([stmt('ALTER TABLE tfav_tags ADD COLUMN parentId TEXT')]);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  } catch (e) { console.warn('turso initSchema', e); }
}

const J = JSON.stringify;

// ---- 收纳 sessions ----
export async function upsertSessionCloud(s) {
  try {
    await execute([stmt(
      `INSERT INTO sessions (id,dateInBox,title,type,resourceIds,locked)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         dateInBox=excluded.dateInBox, title=excluded.title,
         resourceIds=excluded.resourceIds, locked=excluded.locked`,
      [s.id, s.dateInBox || 0, s.title || '', s.type || 'sweep',
       J(s.resourceIds || []), s.locked ? 1 : 0])]);
  } catch (e) { console.warn('turso upsertSession', e); }
}

export async function deleteSessionCloud(id) {
  try { await execute([stmt('DELETE FROM sessions WHERE id=?', [id])]); }
  catch (e) { console.warn('turso deleteSession', e); }
}

// ---- 收纳 items ----
export async function upsertItemCloud(it) {
  try {
    await execute([stmt(
      `INSERT INTO items (id,pathKey,title,titleClean,urls,collectedCount,firstCollectedAt,lastCollectedAt,starred,bookmarkIds,lastStarredAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         pathKey=excluded.pathKey, title=excluded.title, titleClean=excluded.titleClean,
         urls=excluded.urls, collectedCount=excluded.collectedCount,
         lastCollectedAt=excluded.lastCollectedAt, starred=excluded.starred,
         bookmarkIds=excluded.bookmarkIds, lastStarredAt=excluded.lastStarredAt`,
      [it.id, it.pathKey, it.title, it.titleClean, J(it.urls || []),
       it.collectedCount || 0, it.firstCollectedAt || 0, it.lastCollectedAt || 0,
       it.starred ? 1 : 0, J(it.bookmarkIds || []), it.lastStarredAt ?? null])]);
  } catch (e) { console.warn('turso upsertItem', e); }
}

export async function deleteItemCloud(id) {
  try { await execute([stmt('DELETE FROM items WHERE id=?', [id])]); }
  catch (e) { console.warn('turso deleteItem', e); }
}

// ---- 收藏 favorites ----
export async function upsertFavoriteCloud(f) {
  try {
    await execute([stmt(
      `INSERT INTO favorites (id,itemId,pathKey,title,titleClean,url,starredAt,groupIds,tagIds)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         itemId=excluded.itemId, pathKey=excluded.pathKey, title=excluded.title,
         titleClean=excluded.titleClean, url=excluded.url, starredAt=excluded.starredAt,
         groupIds=excluded.groupIds, tagIds=excluded.tagIds`,
      [f.id, f.itemId || null, f.pathKey || '', f.title || '', f.titleClean || '',
       f.url || '', f.starredAt || 0, J(f.groupIds || []), J(f.tagIds || [])])]);
  } catch (e) { console.warn('turso upsertFavorite', e); }
}

export async function deleteFavoriteCloud(id) {
  try { await execute([stmt('DELETE FROM favorites WHERE id=?', [id])]); }
  catch (e) { console.warn('turso deleteFavorite', e); }
}

// ---- 分组 ----
export async function upsertGroupCloud(g) {
  try {
    await execute([stmt(
      `INSERT INTO tfav_groups (id,name,createdAt) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
      [g.id, g.name, g.createdAt || 0])]);
  } catch (e) { console.warn('turso upsertGroup', e); }
}

export async function deleteGroupCloud(id) {
  try { await execute([stmt('DELETE FROM tfav_groups WHERE id=?', [id])]); }
  catch (e) { console.warn('turso deleteGroup', e); }
}

// ---- 标签 ----
export async function upsertTagCloud(t) {
  try {
    await execute([stmt(
      `INSERT INTO tfav_tags (id,name,color,parentId,createdAt) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, color=excluded.color, parentId=excluded.parentId`,
      [t.id, t.name, t.color || '', t.parentId ?? null, t.createdAt || 0])]);
  } catch (e) { console.warn('turso upsertTag', e); }
}

export async function deleteTagCloud(id) {
  try { await execute([stmt('DELETE FROM tfav_tags WHERE id=?', [id])]); }
  catch (e) { console.warn('turso deleteTag', e); }
}
