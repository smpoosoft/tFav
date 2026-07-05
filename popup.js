const btnSweep = document.getElementById('btnSweep');
const btnView = document.getElementById('btnView');
const cbKeepTabs = document.getElementById('cbKeepTabs');
const statusEl = document.getElementById('status');

let sweeping = false;

btnSweep.addEventListener('click', async () => {
  if (sweeping) return;
  sweeping = true;
  btnSweep.textContent = '收纳中…';
  btnSweep.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'sweep',
      closeTabs: cbKeepTabs.checked
    });

    if (result && result.error) {
      statusEl.textContent = result.error;
      statusEl.className = 'error';
    } else if (result) {
      const k = result.keepCount || 0;
      const c = result.closeCount || 0;
      const d = result.dupCount || 0;
      const parts = [];
      if (k > 0) parts.push(`保存 ${k} 条`);
      if (c > 0) parts.push(`关闭 ${c} 个标签`);
      if (d > 0) parts.push(`去重合并 ${d} 条`);
      if (parts.length === 0) {
        statusEl.textContent = '✓ ' + (result.message || '完成');
      } else {
        statusEl.textContent = `✓ ${parts.join('，')}`;
      }
    }
  } catch (err) {
    statusEl.textContent = '收纳失败：' + (err.message || err);
    statusEl.className = 'error';
  }

  sweeping = false;
  btnSweep.textContent = '收纳';
  btnSweep.disabled = false;
});

btnView.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && t.url.includes('tfav.html'));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url: 'tfav.html' });
  }
  window.close();
});
