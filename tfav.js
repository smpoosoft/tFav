import { getItems, getSessions, getSettings, getGroups, getTags } from './lib/storage.js';

let items = [];
let sessions = [];
let groups = [];
let tags = [];
let settings = {};
let dupGroups = [];
let currentTab = 'sweep';
let starredSelection = new Set();
let activeGroupId = null;
let activeTagId = null;
let syncInited = false;
let reloadTimer = null;
let loading = false;

const send = (msg) => chrome.runtime.sendMessage(msg);
const saveSession = (session) => send({ action: 'updateSession', session });
const removeSession = (sessionId) => send({ action: 'deleteSession', sessionId });

async function load(skipSync) {
  if (loading) return;
  loading = true;
  try {
    settings = await getSettings();
    applyTheme();
    if (!skipSync && !syncInited) {
      syncInited = true;
      try { await send({ action: 'startup-sync' }); } catch {}
    }
    items = await getItems();
    sessions = await getSessions();
    groups = await getGroups();
    tags = await getTags();
    try {
      const r = await send({ action: 'analyzeDuplicates' });
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
function findDupGroupFor(item) { return dupGroups.find((g) => g.some((it) => it.id === item.id)) || null; }

function mkBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

function renderFavicon(it) {
  const fav = document.createElement('div');
  fav.className = 'favicon';
  if (it.urls?.[0]?.url) fav.textContent = (it.title || '?')[0];
  return fav;
}
function renderTitle(it) {
  const titleEl = document.createElement('span');
  titleEl.className = 'item-title';
  titleEl.textContent = it.title || '(无标题)';
  titleEl.title = it.urls?.[0]?.url || '';
  return titleEl;
}

function render() {
  const totalDupRedundant = dupGroups.reduce((s, g) => s + (g.length - 1), 0);
  const starredItems = items.filter((it) => it.starred);
  document.getElementById('viewSweep').classList.toggle('hidden', currentTab !== 'sweep');
  document.getElementById('viewStar').classList.toggle('hidden', currentTab !== 'star');
  document.getElementById('tabSweep').classList.toggle('active', currentTab === 'sweep');
  document.getElementById('tabStar').classList.toggle('active', currentTab === 'star');
  document.getElementById('btnDeleteAll').style.display = currentTab === 'sweep' ? '' : 'none';

  if (currentTab === 'sweep') {
    document.getElementById('stats').textContent =
      `收纳 ${sessions.length} 组${totalDupRedundant ? ` · 收藏冗余 ${totalDupRedundant}` : ''}`;
    renderSweepView();
  } else {
    document.getElementById('stats').textContent =
      `收藏 ${starredItems.length} 条${totalDupRedundant ? ` · 冗余 ${totalDupRedundant}（${dupGroups.length} 组）` : ''}`;
    renderStarView(starredItems);
  }
}

function renderSweepView() {
  const root = document.getElementById('viewSweep');
  root.innerHTML = '';
  if (sessions.length === 0) {
    root.innerHTML = '<div class="empty-state">还没有收纳过标签页<br>点击工具栏 tFav 图标开始</div>';
    return;
  }
  const sorted = [...sessions].sort((a, b) => b.dateInBox - a.dateInBox);
  for (const sess of sorted) root.appendChild(renderSessionCard(sess));
}

function renderSessionCard(sess) {
  const card = document.createElement('div');
  card.className = 'session-card';

  const header = document.createElement('div');
  header.className = 'session-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'session-title';
  titleSpan.textContent = sess.title;
  titleSpan.title = '双击改名';
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
    await saveSession(sess);
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
      if (it) body.appendChild(renderSessionRow(sess, it, rid));
    }
  }
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'session-actions';

  actions.appendChild(mkBtn('全部恢复', 'btn accent small', async () => {
    const ids = [...sess.resourceIds];
    if (ids.length > 50 && !confirm(`将恢复 ${ids.length} 个标签页，确定？`)) return;
    for (const rid of ids) {
      const it = items.find((x) => x.id === rid);
      const url = it?.urls?.[it.urls.length - 1]?.url;
      if (url) await chrome.tabs.create({ url });
    }
    if (!sess.locked) { await removeSession(sess.id); }
    await load();
    toast(`已恢复 ${ids.length} 个标签页`);
  }));

  actions.appendChild(mkBtn('全部恢复并保留', 'btn small', async () => {
    const ids = [...sess.resourceIds];
    if (ids.length > 50 && !confirm(`将恢复 ${ids.length} 个标签页，确定？`)) return;
    for (const rid of ids) {
      const it = items.find((x) => x.id === rid);
      const url = it?.urls?.[it.urls.length - 1]?.url;
      if (url) await chrome.tabs.create({ url });
    }
    toast(`已恢复 ${ids.length} 个标签页（保留在列表）`);
  }));

  actions.appendChild(mkBtn('删除组', 'btn danger small', async () => {
    if (!confirm('确定删除这组？（收藏内容不受影响）')) return;
    await removeSession(sess.id);
    await load();
    toast('已删除');
  }));

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
    await send({ action: it.starred ? 'unstarItem' : 'starItem', itemId: it.id });
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
    if (sess.resourceIds.length === 0 && !sess.locked) { await removeSession(sess.id); }
    else { await saveSession(sess); }
    await load();
    toast('已从该组移除（收藏内容不受影响）');
  });
  row.appendChild(delBtn);

  row.addEventListener('click', async () => {
    const url = it.urls?.[it.urls.length - 1]?.url;
    if (url) await chrome.tabs.create({ url });
  });
  return row;
}

// ========== 收藏视图（三栏） ==========
function renderStarView(starredItems) {
  renderGroupPane(starredItems);
  renderStarPane(starredItems);
  renderTagPane(starredItems);
}

function renderGroupPane(starredItems) {
  const root = document.getElementById('groupList');
  root.innerHTML = '';

  root.appendChild(groupRow({ id: null, name: '全部' }, starredItems.length, activeGroupId === null));
  const ungrouped = starredItems.filter((it) => !(it.groupIds || []).length).length;
  root.appendChild(groupRow({ id: '__ungrouped__', name: '未分组' }, ungrouped, activeGroupId === '__ungrouped__'));

  for (const g of groups) {
    const cnt = starredItems.filter((it) => (it.groupIds || []).includes(g.id)).length;
    root.appendChild(groupRow(g, cnt, activeGroupId === g.id));
  }

  document.getElementById('btnAddGroup').onclick = async () => {
    const name = prompt('分组名称', '新分组');
    if (!name) return;
    await send({ action: 'addGroup', name });
    await load(true);
    toast('已添加分组');
  };
}

function groupRow(g, count, active) {
  const el = document.createElement('div');
  el.className = 'group-item' + (active ? ' active' : '');
  el.dataset.groupId = g.id ?? '';

  const name = document.createElement('span');
  name.className = 'g-name';
  name.textContent = g.name;
  el.appendChild(name);

  const cnt = document.createElement('span');
  cnt.className = 'g-count';
  cnt.textContent = count;
  el.appendChild(cnt);

  if (g.id && g.id !== '__ungrouped__') {
    const del = document.createElement('button');
    del.className = 'g-del';
    del.textContent = '✕';
    del.title = '删除分组';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`删除分组「${g.name}」？条目不会被删除。`)) return;
      await send({ action: 'removeGroup', groupId: g.id });
      if (activeGroupId === g.id) activeGroupId = null;
      await load(true);
    });
    el.appendChild(del);

    name.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      const nv = prompt('重命名分组', g.name);
      if (!nv || nv === g.name) return;
      await send({ action: 'renameGroup', groupId: g.id, name: nv });
      await load(true);
    });
  }

  el.addEventListener('click', () => {
    activeGroupId = activeGroupId === g.id ? null : g.id;
    render();
  });

  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const itemId = e.dataTransfer.getData('text/item-id');
    if (!itemId || !g.id || g.id === '__ungrouped__') return;
    await send({ action: 'assignItemGroup', itemId, groupId: g.id, add: true });
    await load(true);
    toast('已移入分组');
  });
  return el;
}

function renderTagPane(starredItems) {
  const root = document.getElementById('tagTree');
  root.innerHTML = '';

  root.appendChild(tagRow({ id: null, name: '全部' }, starredItems.length, activeTagId === null));

  for (const t of tags) {
    const cnt = starredItems.filter((it) => (it.tagIds || []).includes(t.id)).length;
    root.appendChild(tagRow(t, cnt, activeTagId === t.id));
  }

  document.getElementById('btnAddTag').onclick = async () => {
    const name = prompt('标签名称', '新标签');
    if (!name) return;
    const colors = ['#F5A623', '#188038', '#1A73E8', '#D93025', '#9334E6', '#E37400'];
    const color = colors[tags.length % colors.length];
    await send({ action: 'addTag', name, color });
    await load(true);
    toast('已添加标签');
  };
}

function tagRow(t, count, active) {
  const el = document.createElement('div');
  el.className = 'tag-item' + (active ? ' active' : '');
  el.dataset.tagId = t.id ?? '';

  if (t.id) {
    const dot = document.createElement('span');
    dot.className = 't-dot';
    dot.style.background = t.color || 'var(--accent)';
    el.appendChild(dot);
  }

  const name = document.createElement('span');
  name.className = 't-name';
  name.textContent = t.name;
  el.appendChild(name);

  const cnt = document.createElement('span');
  cnt.className = 't-count';
  cnt.textContent = count;
  el.appendChild(cnt);

  if (t.id) {
    const del = document.createElement('button');
    del.className = 't-del';
    del.textContent = '✕';
    del.title = '删除标签';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`删除标签「${t.name}」？条目不会被删除。`)) return;
      await send({ action: 'removeTag', tagId: t.id });
      if (activeTagId === t.id) activeTagId = null;
      await load(true);
    });
    el.appendChild(del);

    name.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      const nv = prompt('重命名标签', t.name);
      if (!nv || nv === t.name) return;
      await send({ action: 'renameTag', tagId: t.id, name: nv });
      await load(true);
    });
  }

  el.addEventListener('click', () => {
    activeTagId = activeTagId === t.id ? null : t.id;
    render();
  });

  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const itemId = e.dataTransfer.getData('text/item-id');
    if (!itemId || !t.id) return;
    await send({ action: 'assignItemTag', itemId, tagId: t.id, add: true });
    await load(true);
    toast(`已打上标签「${t.name}」`);
  });
  return el;
}

// ---- 中：条目列表 ----
function renderStarPane(allStarred) {
  const root = document.getElementById('starList');
  root.innerHTML = '';

  // 顶部工具栏
  const toolbar = document.createElement('div');
  toolbar.className = 'star-toolbar';

  const selAll = document.createElement('label');
  selAll.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer';
  selAll.innerHTML = '<input type="checkbox" id="cbSelectAll"> 全选';
  toolbar.appendChild(selAll);

  const filterInfo = document.createElement('span');
  filterInfo.className = 'filter-info';
  const parts = [];
  if (activeGroupId && activeGroupId !== '__ungrouped__') parts.push(`分组:${groups.find((g) => g.id === activeGroupId)?.name || ''}`);
  if (activeGroupId === '__ungrouped__') parts.push('未分组');
  if (activeTagId) parts.push(`标签:${tags.find((t) => t.id === activeTagId)?.name || ''}`);
  filterInfo.textContent = parts.length ? parts.join(' · ') : '';
  toolbar.appendChild(filterInfo);

  if (parts.length) {
    const clearBtn = mkBtn('清除筛选', 'btn small ghost clear-filter', () => {
      activeGroupId = null; activeTagId = null; render();
    });
    toolbar.appendChild(clearBtn);
  }
  root.appendChild(toolbar);

  // 批量操作条
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
  root.appendChild(batchBar);

  // 过滤
  const filtered = allStarred.filter((it) => {
    if (activeGroupId === '__ungrouped__' && (it.groupIds || []).length) return false;
    if (activeGroupId && activeGroupId !== '__ungrouped__' && !(it.groupIds || []).includes(activeGroupId)) return false;
    if (activeTagId && !(it.tagIds || []).includes(activeTagId)) return false;
    return true;
  }).sort((a, b) => (b.lastStarredAt || 0) - (a.lastStarredAt || 0));

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = parts.length ? '该筛选下没有收藏条目' : '没有收藏内容';
    root.appendChild(empty);
  }

  for (const it of filtered) root.appendChild(renderStarredRow(it));

  document.getElementById('cbSelectAll').addEventListener('change', (e) => {
    if (e.target.checked) filtered.forEach((it) => starredSelection.add(it.id));
    else starredSelection.clear();
    updateBatchBar();
    rerenderStarRows(root, filtered);
  });

  document.getElementById('batchOpen').addEventListener('click', async () => {
    const selected = filtered.filter((it) => starredSelection.has(it.id));
    if (selected.length > 20 && !confirm(`将打开 ${selected.length} 个标签页，确定？`)) return;
    for (const it of selected) {
      const url = it.urls?.[it.urls.length - 1]?.url;
      if (url) { try { await chrome.tabs.create({ url }); } catch {} }
    }
    toast(`已恢复 ${selected.length} 个标签`);
  });
  document.getElementById('batchUnstar').addEventListener('click', async () => {
    const selected = filtered.filter((it) => starredSelection.has(it.id));
    if (!confirm(`将取消 ${selected.length} 条收藏（同时从浏览器书签删除），确定？`)) return;
    for (const it of selected) {
      await send({ action: 'unstarItem', itemId: it.id });
    }
    starredSelection.clear();
    await load();
    toast('已批量取消收藏');
  });
  document.getElementById('batchClear').addEventListener('click', () => {
    starredSelection.clear(); updateBatchBar();
    const cb = document.getElementById('cbSelectAll'); if (cb) cb.checked = false;
    rerenderStarRows(root, filtered);
  });

  updateBatchBar();
}

function rerenderStarRows(root, filtered) {
  root.querySelectorAll('.starred-row').forEach((r) => r.remove());
  const empty = root.querySelector('.empty-state');
  if (empty) empty.remove();
  for (const it of filtered) root.appendChild(renderStarredRow(it));
}

function renderStarredRow(it) {
  const row = document.createElement('div');
  row.className = 'item-row starred-row';
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/item-id', it.id);
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));

  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.className = 'row-checkbox';
  cb.checked = starredSelection.has(it.id);
  cb.addEventListener('change', (e) => {
    if (e.target.checked) starredSelection.add(it.id); else starredSelection.delete(it.id);
    updateBatchBar();
  });
  cb.addEventListener('click', (e) => e.stopPropagation());
  row.appendChild(cb);

  const star = document.createElement('button');
  star.className = 'star-btn starred';
  star.textContent = '★';
  star.title = '取消收藏';
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await send({ action: 'unstarItem', itemId: it.id }); }
    catch (err) { toast('取消失败: ' + (err.message || err)); return; }
    starredSelection.delete(it.id);
    await load();
    toast('已取消收藏');
  });
  row.appendChild(star);

  row.appendChild(renderFavicon(it));
  row.appendChild(renderTitle(it));

  // 标签徽章（可点掉）
  for (const tid of it.tagIds || []) {
    const tag = tags.find((t) => t.id === tid);
    if (!tag) continue;
    const badge = document.createElement('span');
    badge.className = 'row-tag';
    badge.style.borderLeft = `3px solid ${tag.color || 'var(--accent)'}`;
    badge.textContent = tag.name;
    badge.title = '点击移除该标签';
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      await send({ action: 'assignItemTag', itemId: it.id, tagId: tid, add: false });
      await load(true);
    });
    row.appendChild(badge);
  }

  row.appendChild(mkBtn('标签', 'btn small ghost', () => {
    const panel = row.querySelector('.tag-panel');
    if (panel) panel.classList.toggle('open');
  }));
  row.appendChild(buildTagPanel(it));

  const dupGroup = findDupGroupFor(it);
  if (dupGroup) {
    const expand = mkBtn('展开 ›', 'btn small ghost', () => {
      const panel = row.querySelector('.dup-panel');
      if (panel) panel.classList.toggle('open');
    });
    row.appendChild(expand);
    const dupBadge = document.createElement('span');
    dupBadge.className = 'dup-badge clickable';
    dupBadge.textContent = `重复 ×${dupGroup.length}`;
    row.appendChild(dupBadge);
    row.appendChild(buildDupPanel(dupGroup, it));
  }

  row.appendChild(mkBtn('打开 ↗', 'btn small ghost', async () => {
    const url = it.urls?.[it.urls.length - 1]?.url;
    if (url) await chrome.tabs.create({ url });
  }));

  row.appendChild(mkBtn('✎', 'btn small ghost', () => {
    const nv = prompt('输入新标题', it.title);
    if (!nv || nv === it.title) return;
    send({ action: 'renameItem', itemId: it.id, title: nv }).then(() => load(true));
  }));

  row.addEventListener('click', async () => {
    const url = it.urls?.[it.urls.length - 1]?.url;
    if (url) await chrome.tabs.create({ url });
  });
  return row;
}

function buildTagPanel(it) {
  const panel = document.createElement('div');
  panel.className = 'tag-panel';
  panel.addEventListener('click', (e) => e.stopPropagation());

  if (tags.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'tag-panel-hint';
    hint.textContent = '还没有标签。先在右侧添加标签，再回来多选。';
    panel.appendChild(hint);
    return panel;
  }

  const current = new Set(it.tagIds || []);
  for (const tag of tags) {
    const label = document.createElement('label');
    label.className = 'tag-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = current.has(tag.id);
    input.addEventListener('change', async () => {
      await send({ action: 'assignItemTag', itemId: it.id, tagId: tag.id, add: input.checked });
      toast(input.checked ? `已添加标签「${tag.name}」` : `已移除标签「${tag.name}」`);
    });

    const dot = document.createElement('span');
    dot.className = 't-dot small';
    dot.style.background = tag.color || 'var(--accent)';

    const name = document.createElement('span');
    name.textContent = tag.name;

    label.append(input, dot, name);
    panel.appendChild(label);
  }
  panel.appendChild(mkBtn('完成', 'btn small accent', async () => {
    panel.classList.remove('open');
    await load(true);
  }));
  return panel;
}

function buildDupPanel(group, current) {
  const panel = document.createElement('div');
  panel.className = 'dup-panel';
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
  panel.appendChild(mkBtn('合并保留所选', 'btn accent small', async () => {
    const selected = panel.querySelector('input[type=radio]:checked');
    if (!selected) return;
    await send({ action: 'mergeGroup', groupIds: group.map((g) => g.id), keepId: selected.value });
    await load();
    toast('已合并重复');
  }));
  return panel;
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  if (!bar) return;
  const n = starredSelection.size;
  if (n === 0) {
    bar.classList.remove('show');
    const cb = document.getElementById('cbSelectAll'); if (cb) cb.checked = false;
  } else {
    bar.classList.add('show');
    document.getElementById('batchInfo').textContent = `已选 ${n} 条`;
  }
}

function startEdit(sess, el) {
  const input = document.createElement('input');
  input.className = 'session-title editing';
  input.value = sess.title;
  input.addEventListener('blur', async () => {
    if (input.value.trim()) { sess.title = input.value.trim(); await saveSession(sess); }
    render();
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { sess.title = fmtTS(sess.dateInBox); await saveSession(sess); render(); }
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
  return `${d.getFullYear()}_${p(d.getMonth()+1)}_${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

document.getElementById('btnDeleteAll').addEventListener('click', async () => {
  const unlocked = sessions.filter((s) => !s.locked);
  if (unlocked.length === 0) { toast('没有可删除的非锁定组'); return; }
  if (!confirm(`将删除 ${unlocked.length} 个非锁定组（收藏内容不受影响），确定？`)) return;
  await send({ action: 'clearUnlockedSessions' });
  await load();
  toast(`已删除 ${unlocked.length} 组`);
});

document.getElementById('tabSweep').addEventListener('click', () => { currentTab = 'sweep'; render(); });
document.getElementById('tabStar').addEventListener('click', () => { currentTab = 'star'; render(); });

chrome.storage.onChanged.addListener((changes) => {
  if (!changes.tfav_sessions && !changes.tfav_items && !changes.tfav_groups && !changes.tfav_tags) return;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => load(true), 200);
});

load();
