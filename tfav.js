import { getItems, getSessions, upsertSession, deleteSession,
         deleteItem, getSettings, KEYS } from './lib/storage.js';

let items = [];
let sessions = [];
let settings = {};

async function load() {
  settings = await getSettings();
  applyTheme();
  items = await getItems();
  sessions = await getSessions();
  render();
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

function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  sessions.sort((a, b) => b.dateInBox - a.dateInBox);

  if (sessions.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:14px;">还没有收纳过标签页<br>点击工具栏 tFav 图标开始</div>';
    return;
  }

  for (const sess of sessions) {
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
        const row = document.createElement('div');
        row.className = 'item-row';

        const fav = document.createElement('div');
        fav.className = 'favicon';
        const favTarget = it.urls?.[0]?.url || '';
        if (favTarget) {
          fav.dataset.url = favTarget;
          fav.textContent = (it.title || '?')[0];
        }
        row.appendChild(fav);

        const titleEl = document.createElement('span');
        titleEl.className = 'item-title';
        titleEl.textContent = it.title || '(无标题)';
        titleEl.title = it.urls?.[0]?.url || '';
        row.appendChild(titleEl);

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
          if (sess.resourceIds.length === 0 && !sess.locked) {
            await deleteSession(sess.id);
          } else {
            await upsertSession(sess);
          }
          render();
          toast('已删除');
        });
        row.appendChild(delBtn);

        row.addEventListener('click', async () => {
          const url = it.urls?.[it.urls.length - 1]?.url;
          if (url) {
            await chrome.tabs.create({ url });
            sess.resourceIds = sess.resourceIds.filter((id) => id !== rid);
            if (sess.resourceIds.length === 0 && !sess.locked) {
              await deleteSession(sess.id);
            } else {
              await upsertSession(sess);
            }
            render();
          }
        });
        body.appendChild(row);
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
      if (!sess.locked) {
        await deleteSession(sess.id);
      }
      render();
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
      if (!confirm('确定删除这组？')) return;
      await deleteSession(sess.id);
      render();
      toast('已删除');
    });
    actions.appendChild(delSessBtn);

    card.appendChild(actions);
    list.appendChild(card);
  }
}

function startEdit(sess, el) {
  const input = document.createElement('input');
  input.className = 'session-title editing';
  input.value = sess.title;
  input.addEventListener('blur', async () => {
    if (input.value.trim()) {
      sess.title = input.value.trim();
      await upsertSession(sess);
    }
    render();
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { sess.title = fmtTS(sess.dateInBox); await upsertSession(sess); render(); }
  });
  el.replaceWith(input);
  input.focus();
  input.select();
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
  if (!confirm(`将删除 ${unlocked.length} 个非锁定组（共 ${sessions.length} 组），确定？`)) return;
  const allSessions = await getSessions();
  const kept = allSessions.filter((s) => s.locked);
  await chrome.storage.local.set({ [KEYS.SESSIONS]: kept });
  sessions = kept;
  render();
  toast(`已删除 ${unlocked.length} 组`);
});

document.getElementById('btnSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: 'popup.html' });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.tfav_sessions || changes.tfav_items) {
    load();
  }
});

load();
