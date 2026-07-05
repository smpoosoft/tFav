import { collectBatch } from './lib/dedupe.js';
import { getSettings, getSchemaVersion, setSchemaVersion } from './lib/storage.js';

const SELF_URLS = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  const ver = await getSchemaVersion();
  if (ver === 0) await setSchemaVersion(1);
});

chrome.action.onClicked.addListener(async (tab) => {
  const selfUrl = `chrome-extension://${chrome.runtime.id}/`;
  SELF_URLS.add(selfUrl + 'tfav.html');
  SELF_URLS.add(selfUrl + 'popup.html');

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
    try {
      await chrome.tabs.update(tab.id, { url: selfUrl + 'tfav.html' });
    } catch {}
    return;
  }

  const result = await collectBatch(collectable, now);

  const failedIds = [];
  for (const t of collectable) {
    try {
      await chrome.tabs.remove(t.id);
    } catch {
      failedIds.push(t.id);
    }
  }

  const existingPage = allTabs.find((t) => t.url && t.url.includes('tfav.html'));
  if (existingPage) {
    await chrome.tabs.update(existingPage.id, { active: true });
  } else {
    await chrome.tabs.create({ url: selfUrl + 'tfav.html' });
  }
});
