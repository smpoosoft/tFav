export const KEYS = {
  ITEMS: 'tfav_items',
  SESSIONS: 'tfav_sessions',
  SETTINGS: 'tfav_settings',
  SCHEMA: 'tfav_schema_version',
};

export function generateId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let id = '';
  for (const v of b) id += v.toString(16).padStart(2, '0');
  return id;
}

function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (r) => {
      resolve(key ? r[key] : r);
    });
  });
}

function set(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

function remove(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve);
  });
}

export async function getSchemaVersion() {
  const v = await get(KEYS.SCHEMA);
  return v || 0;
}
export async function setSchemaVersion(v) {
  await set({ [KEYS.SCHEMA]: v });
}

export async function getItems() {
  return (await get(KEYS.ITEMS)) || [];
}
async function putItems(arr) {
  await set({ [KEYS.ITEMS]: arr });
}

export async function upsertItem(item) {
  const arr = await getItems();
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.push(item);
  await putItems(arr);
  return item;
}

export async function deleteItem(id) {
  const arr = (await getItems()).filter((x) => x.id !== id);
  await putItems(arr);
}

export async function getSessions() {
  return (await get(KEYS.SESSIONS)) || [];
}
async function putSessions(arr) {
  await set({ [KEYS.SESSIONS]: arr });
}

export async function upsertSession(s) {
  const arr = await getSessions();
  const i = arr.findIndex((x) => x.id === s.id);
  if (i >= 0) arr[i] = s; else arr.push(s);
  await putSessions(arr);
  return s;
}

export async function deleteSession(id) {
  const arr = (await getSessions()).filter((x) => x.id !== id);
  await putSessions(arr);
}

export async function getSettings() {
  const s = await get(KEYS.SETTINGS);
  return s || { theme: 'auto', includePinned: false };
}
export async function setSettings(s) {
  await set({ [KEYS.SETTINGS]: s });
}
