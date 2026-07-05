const themeSelect = document.getElementById('themeSelect');
const includePinned = document.getElementById('includePinned');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

chrome.storage.local.get('tfav_settings', (res) => {
  const s = res.tfav_settings || {};
  themeSelect.value = s.theme || 'auto';
  includePinned.checked = s.includePinned || false;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    tfav_settings: {
      theme: themeSelect.value,
      includePinned: includePinned.checked,
    }
  }, () => {
    statusEl.textContent = '✅ 已保存';
    setTimeout(() => (statusEl.textContent = ''), 1500);
  });
});
