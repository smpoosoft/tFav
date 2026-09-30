import { getItems, getSessions, upsertSession, deleteSession,
         deleteItem, getSettings, KEYS, getStarredItems } from './lib/storage.js';
import { extractPathKey, cleanTitle } from './lib/urlkit.js';

let items = [];
let sessions = [];
let settings = {};
let dupGroups = [];
let currentTab = 'sweep';
let starredSelection = new Set();
let syncInited = false;
let reloadTimer = null;
let loading = false;

async function load(skipSync) {
  if (loading) return;
  loading = true;
  try {
    settings = await getSettings();
    applyTheme();
    if (!skipSync && !syncInited) {
      syncInited = true;
      try { await chrome.runtime.sendMessage({ action: 'startup-sync' }); } catch {}
    }
    items = await getItems();
    sessions = await getSessions();
    try {
      const r = await chrome.runtime.sendMessage({ action: 'analyzeDuplicates' });
      dupGroups = r?.groups || [];
    } catch { dupGroups = []; }
    render();
  } finally {
    loading = false;
  }
}

function applyTheme() {
  const m = settings.theme;
  if (m === 'dark') document.body.className = 'dark';
  else if (m === 'light') document.body.className = 'light';
  else document.body.className = (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function findDupGroupFor(item) {
  return dupGroups.find((g) => g.some((it) => it.id === item.id)) || null;
}

function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  const statsEl = document.getElementById('stats');
  const starredItems = items.filter((it) => it.starred).sort((a, b) => (b.lastStarredAt || 0) - (a.lastStarredAt || 0));
  const totalDupRedundant = dupGroups.reduce((s, g) => s + (g.length - 1), 0);

  const btnDeleteAll = document.getElementById('btnDeleteAll');
  const sweepCount = sessions.length;
  if (currentTab === 'sweep') {
    statsEl.textContent = `收纳 ${sweepCount} 组${totalDupRedundant ? ` · 收藏冗余 ${totalDupRedundant}` : ''}`;
    btnDeleteAll.style.display = '';
    renderSessionSection(list);
  } else {
    statsEl.textContent = `收藏 ${starredItems.length} 条${totalDupRedundant ? ` · 冗余 ${totalDupRedundant}（${dupGroups.length} 组）` : ''}`;
    btnDeleteAll.style.display = 'none';
    renderStarredSection(list, starredItems);
  }
}

function renderStarredSection(list, starredItems) {
  const topBar = document.createElement('div');
  topBar.className = 'session-actions';

  const selectAll = document.createElement('label');
  selectAll.className = 'checkbox-row';
  selectAll.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);margin:0';
  selectAll.innerHTML = '<input type="checkbox" id="cbSelectAll"> 全选';
  topBar.appendChild(selectAll);

  const spacer = document.createElement('div'); spacer.style.flex = '1'; topBar.appendChild(spacer);

  const dupBtn = document.createElement('button');
  dupBtn.className = 'btn small';
  dupBtn.textContent = `仅看冗余 (${dupGroups.reduce((s, g) => s + (g.length - 1), 0)})`;
  dupBtn.disabled = dupGroups.length === 0;
  if (dupGroups.length === 0) dupBtn.style.opacity = '.5';
  dupBtn.addEventListener('click', () => {
    list.dataset.filter = list.dataset.filter === 'dup' ? '' : 'dup';
    rerenderStarredBody();
  });
  topBar.appendChild(dupBtn);

  list.appendChild(topBar);

  const batchBar = document.createElement('div');
  batchBar.className = 'batch-bar';
  batchBar.id = 'batchBar';
  batchBar.innerHTML = `
    <span class="batch-info" id="batchInfo">未选择</span>
    <div class="batch-actions">
      <button class="btn accent small" id="batchOpen">恢复为标签</button>
      <button class="btn small" id="batchUnstar">取消收藏</button>
      <button class="btn danger small" id="batchClear">清空选择</button>
    </div>`;
  list.appendChild(batchBar);

  const body = document.createElement('div');
  body.id = 'starredBody';
  list.appendChild(body);

  list.dataset.filter = '';
  rerenderStarredBody();

  document.getElementById('cbSelectAll').addEventListener('change', (e) => {
    const starred = items.filter((it) => it.starred);
    if (e.target.checked) starred.forEach((it) => starredSelection.add(it.id));
    else starredSelection.clear();
    updateBatchBar();
    rerenderStarredBody();
  });

  document.getElementById('batchOpen').addEventListener('click', async () => {
    const selected = starredFilter().filter((it) => starredSelection.has(it.id));
    if (selected.length > 20 && !confirm(`将打开 ${selected.length} 个标签页，确定？`)) return;
    for (const it of selected) {
      const url = it.urls?.[it.urls.length - 1]?.url;
      if (url) { try { await chrome.tabs.create({ url }); } catch {} }
    }
    toast(`已恢复 ${selected.length} 个标签`);
  });
  document.getElementById('batchUnstar').addEventListener('click', async () => {
    const selected = starredFilter().filter((it) => starredSelection.has(it.id));
    if (!confirm(`将取消 ${selected.length} 条收藏（同时从浏览器书签删除），确定？`)) return;
    for (const it of selected) {
      await chrome.runtime.sendMessage({ action: 'unstarItem', itemId: it.id });
    }
    starredSelection.clear();
    await load();
    toast('已批量取消收藏');
  });
  document.getElementById('batchClear').addEventListener('click', () => {
    starredSelection.clear(); updateBatchBar(); rerenderStarredBody();
    const cb = document.getElementById('cbSelectAll'); if (cb) cb.checked = false;
  });

  updateBatchBar();
}

function starredFilter() {
  const starred = items.filter((it) => it.starred).sort((a, b) => (b.lastStarredAt || 0) - (a.lastStarredAt || 0));
  const filter = document.getElementById('list').dataset.filter;
  if (filter === 'dup') {
    const ids = new Set(dupGroups.flat().map((it) => it.id));
    return starred.filter((it) => ids.has(it.id));
  }
  return starred;
}

function rerenderStarredBody() {
  const body = document.getElementById('starredBody');
  if (!body) return;
  body.innerHTML = '';
  const starred = starredFilter();
  if (starred.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text2);font-size:14px;">没有收藏内容<br>在浏览器书签栏添加书签，或在收纳列表中点 ★</div>';
    return;
  }
  for (const it of starred) body.appendChild(renderStarredRow(it));
}

function renderStarredRow(it) {
  const row = document.createElement('div');
  row.className = 'item-row starred-row';

  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.className = 'row-checkbox';
  cb.checked = starredSelection.has(it.id);
  cb.addEventListener('change', (e) => {
    if (e.target.checked) starredSelection.add(it.id); else starredSelection.delete(it.id);
    updateBatchBar();
  });
  row.appendChild(cb);

  const star = document.createElement('button');
  star.className = 'star-btn starred';
  star.textContent = '★';
  star.title = '取消收藏';
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await chrome.runtime.sendMessage({ action: 'unstarItem', itemId: it.id }); }
    catch (err) { toast('取消失败: ' + (err.message || err)); return; }
    starredSelection.delete(it.id);
    await load();
    toast('已取消收藏');
  });
  row.appendChild(star);

  row.appendChild(renderFavicon(it));
  row.appendChild(renderTitle(it));

  const dupGroup = findDupGroupFor(it);
  if (dupGroup) {
    const dupBadge = document.createElement('span');
    dupBadge.className = 'dup-badge clickable';
    dupBadge.textContent = `重复 ×${dupGroup.length}`;

    const expand = document.createElement('button');
    expand.className = 'btn small ghost';
    expand.textContent = '展开 ›';
    expand.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = row.querySelector('.dup-panel');
      if (panel) panel.classList.toggle('open');
    });
    row.appendChild(expand);
    row.appendChild(dupBadge);

    row.appendChild(buildDupPanel(dupGroup, it));
  }

  const openBtn = document.createElement('button');
  openBtn.className = 'btn small ghost';
  openBtn.textContent = '打开 ↗';
  openBtn.title = '在新标签打开';
  openBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = it.urls?.[it.urls.length - 1]?.url;
    if (url) await chrome.tabs.create({ url });
  });
  row.appendChild(openBtn);

  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn small ghost';
  renameBtn.textContent = '✎';
  renameBtn.title = '改名（同步回浏览器书签）';
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nv = prompt('输入新标题', it.title);
    if (!nv || nv === it.title) return;
    chrome.runtime.sendMessage({ action: 'renameItem', itemId: it.id, title: nv }, () => load());
  });
  row.appendChild(renameBtn);

  return row;
}

function buildDupPanel(group, current) {
  const panel = document.createElement('div');
  panel.className = 'dup-panel';
  const otherMembers = group.filter((x) => x.id !== current.id);
  panel.innerHTML = `<div class="dup-panel-hint">同一内容共 ${group.length} 份，选保留哪份（其余会从浏览器书签删除）</div>`;
  for (const m of group) {
    const opt = document.createElement('div');
    opt.className = 'dup-member';
    opt.innerHTML = `<input type="radio" name="keep-${group.map((g) => g.id).join('_')}" ${m.id === current.id ? 'checked' : ''}>
      <span class="dup-member-title">${escapeHtml(m.title)}</span>
      <span class="dup-member-meta">${m.bookmarkIds?.length || 0} 书签 · ${m.lastStarredAt ? fmtDate(m.lastStarredAt) : '—'}</span>`;
    opt.querySelector('input').value = m.id;
    panel.appendChild(opt);
  }
  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'btn accent small';
  mergeBtn.textContent = '合并保留所选';
  mergeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const selected = panel.querySelector('input[type=radio]:checked');
    if (!selected) return;
    const keepId = selected.value;
    const groupIds = group.map((g) => g.id);
    await chrome.runtime.sendMessage({ action: 'mergeGroup', groupIds, keepId });
    await load();
    toast('已合并重复');
  });
  panel.appendChild(mergeBtn);
  return panel;
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  if (!bar) return;
  const n = starredSelection.size;
  if (n === 0) {
    bar.classList.remove('show');
    document.getElementById('cbSelectAll').checked = false;
  } else {
    bar.classList.add('show');
    document.getElementById('batchInfo').textContent = `已选 ${n} 条`;
  }
}

function renderSessionSection(list) {
  if (sessions.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:14px;">还没有收纳过标签页<br>点击工具栏 tFav 图标开始</div>';
    return;
  }
  sessions.sort((a, b) => b.dateInBox - a.dateInBox);
  for (const sess of sessions) list.appendChild(renderSessionCard(sess));
}

function renderSessionCard(sess) {
  const card = document.createElement('div');
  card.className = 'session-card';

  const header = document.createElement('div');
  header.className = 'session-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'session-title';
  titleSpan.textContent = sess.title;
  titleSpan.addEventListener('dblclick', () => startEdit(sess, titleSpan));
  header.appendChild(titleSpan);

  const meta = document.createElement('span');
  meta.className = 'session-meta';
  meta.textContent = `${sess.resourceIds.length}条 · ${fmtDate(sess.dateInBox)}`;
  header.appendChild(meta);

  const lockBtn = document.createElement('button');
  lockBtn.className = `lock-btn ${sess.locked ? 'locked' : 'unlocked'}`;
  lockBtn.textContent = sess.locked ? '🔒' : '🔓';
  lockBtn.title = sess.locked ? '已锁定（跳过批量操作）' : '未锁定';
  lockBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    sess.locked = !sess.locked;
    await upsertSession(sess);
    render();
  });
  header.appendChild(lockBtn);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'session-body';

  if (sess.resourceIds.length === 0) {
    body.classList.add('empty');
    body.textContent = '（空组）';
  } else {
    for (const rid of sess.resourceIds) {
      const it = items.find((x) => x.id === rid);
      if (!it) continue;
      body.appendChild(renderSessionRow(sess, it, rid));
    }
  }
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'session-actions';

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn accent small';
  restoreBtn.textContent = '全部恢复';
  restoreBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ids = [...sess.resourceIds];
    if (ids.length > 50 && !confirm(`将恢复 ${ids.length} 个标签页，确定？`)) return;
    for (const rid of ids) {
      const it = items.find((x) => x.id === rid);
      const url = it?.urls?.[it.urls.length - 1]?.url;
      if (url) await chrome.tabs.create({ url });
    }
    if (!sess.locked) { await deleteSession(sess.id); }
    await load();
    toast(`已恢复 ${ids.length} 个标签页`);
  });
  actions.appendChild(restoreBtn);

  const keepBtn = document.createElement('button');
  keepBtn.className = 'btn small';
  keepBtn.textContent = '全部恢复并保留';
  keepBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ids = [...sess.resourceIds];
    if (ids.length > 50 && !confirm(`将恢复 ${ids.length} 个标签页，确定？`)) return;
    for (const rid of ids) {
      const it = items.find((x) => x.id === rid);
      const url = it?.urls?.[it.urls.length - 1]?.url;
      if (url) await chrome.tabs.create({ url });
    }
    toast(`已恢复 ${ids.length} 个标签页（保留在列表）`);
  });
  actions.appendChild(keepBtn);

  const delSessBtn = document.createElement('button');
  delSessBtn.className = 'btn danger small';
  delSessBtn.textContent = '删除组';
  delSessBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('确定删除这组？（收藏内容不受影响）')) return;
    await deleteSession(sess.id);
    await load();
    toast('已删除');
  });
  actions.appendChild(delSessBtn);

  card.appendChild(actions);
  return card;
}

function renderSessionRow(sess, it, rid) {
  const row = document.createElement('div');
  row.className = 'item-row session-row';

  const star = document.createElement('button');
  star.className = `star-btn ${it.starred ? 'starred' : ''}`;
  star.textContent = it.starred ? '★' : '☆';
  star.title = it.starred ? '已收藏（点此取消）' : '加入收藏';
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (it.starred) {
      await chrome.runtime.sendMessage({ action: 'unstarItem', itemId: it.id });
    } else {
      await chrome.runtime.sendMessage({ action: 'starItem', itemId: it.id });
    }
    await load();
  });
  row.appendChild(star);

  row.appendChild(renderFavicon(it));
  row.appendChild(renderTitle(it));

  const badge = document.createElement('span');
  badge.className = 'item-dup-badge';
  const times = it.collectedCount || 0;
  if (times > 1) badge.textContent = `已合并 ${times - 1} 次`;
  row.appendChild(badge);

  const delBtn = document.createElement('button');
  delBtn.className = 'item-delete';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    sess.resourceIds = sess.resourceIds.filter((id) => id !== rid);
    if (sess.resourceIds.length === 0 && !sess.locked) { await deleteSession(sess.id); }
    else { await upsertSession(sess); }
    await load();
    toast('已从该组移除（收藏内容不受影响）');
  });
  row.appendChild(delBtn);

  row.addEventListener('click', async () => {
    const url = it.urls?.[it.urls.length - 1]?.url;
    if (!url) return;
    await chrome.tabs.create({ url });
  });
  return row;
}

function renderFavicon(it) {
  const fav = document.createElement('div');
  fav.className = 'favicon';
  const favTarget = it.urls?.[0]?.url || '';
  if (favTarget) {
    fav.dataset.url = favTarget;
    fav.textContent = (it.title || '?')[0];
  }
  return fav;
}
function renderTitle(it) {
  const titleEl = document.createElement('span');
  titleEl.className = 'item-title';
  titleEl.textContent = it.title || '(无标题)';
  titleEl.title = it.urls?.[0]?.url || '';
  return titleEl;
}

function startEdit(sess, el) {
  const input = document.createElement('input');
  input.className = 'session-title editing';
  input.value = sess.title;
  input.addEventListener('blur', async () => {
    if (input.value.trim()) { sess.title = input.value.trim(); await upsertSession(sess); }
    render();
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { sess.title = fmtTS(sess.dateInBox); await upsertSession(sess); render(); }
  });
  el.replaceWith(input);
  input.focus(); input.select();
}

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtTS(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}_${p(d.getMonth()+1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
}

document.getElementById('btnDeleteAll').addEventListener('click', async () => {
  const unlocked = sessions.filter((s) => !s.locked);
  if (unlocked.length === 0) { toast('没有可删除的非锁定组'); return; }
  if (!confirm(`将删除 ${unlocked.length} 个非锁定组（收藏内容不受影响），确定？`)) return;
  const allSessions = await getSessions();
  const kept = allSessions.filter((s) => s.locked);
  await chrome.storage.local.set({ [KEYS.SESSIONS]: kept });
  await load();
  toast(`已删除 ${unlocked.length} 组`);
});

document.getElementById('btnSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: 'popup.html' });
});

document.getElementById('tabSweep').addEventListener('click', () => {
  currentTab = 'sweep';
  document.getElementById('tabSweep').classList.add('active');
  document.getElementById('tabStar').classList.remove('active');
  render();
});
document.getElementById('tabStar').addEventListener('click', () => {
  currentTab = 'star';
  document.getElementById('tabStar').classList.add('active');
  document.getElementById('tabSweep').classList.remove('active');
  render();
});

chrome.storage.onChanged.addListener((changes) => {
  if (!changes.tfav_sessions && !changes.tfav_items) return;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => load(true), 200);
});

load();