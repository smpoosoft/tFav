import { collectBatch } from './lib/dedupe.js';
import { getSettings, getSchemaVersion, setSchemaVersion } from './lib/storage.js';

chrome.runtime.onInstalled.addListener(async () => {
  const ver = await getSchemaVersion();
  if (ver === 0) await setSchemaVersion(1);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'sweep') {
    handleSweep(msg.closeTabs === true)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }
});

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

  if (collectable.length === 0) {
    return { keepCount: 0, closeCount: 0, dupCount: 0, message: '没有可收纳的标签页' };
  }

  const result = await collectBatch(collectable, now);

  let closeCount = 0;
  if (closeTabs) {
    for (const t of collectable) {
      try { await chrome.tabs.remove(t.id); closeCount++; } catch {}
    }
  }

  return {
    keepCount: result.newCount,
    closeCount: closeCount,
    dupCount: result.dupCount,
    total: result.total,
  };
}
