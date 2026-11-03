// 기기 안 저장소: IndexedDB(응시 기록·녹음), localStorage(화면 설정).
const DB = 'speaking-lab', VER = 2;   // 2: 학생 정보(profile) 추가
let dbp;
function db() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('attempts')) d.createObjectStore('attempts', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('recordings')) d.createObjectStore('recordings');
      if (!d.objectStoreNames.contains('profile')) d.createObjectStore('profile', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const putAttempt = (a) => tx('attempts', 'readwrite', (s) => s.put(structuredClone(a)));
export const getAttempt = (id) => tx('attempts', 'readonly', (s) => s.get(id));
export const listAttempts = async () => ((await tx('attempts', 'readonly', (s) => s.getAll())) || [])
  .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
export const putRecording = (id, num, rec) => tx('recordings', 'readwrite', (s) => s.put(rec, `${id}:${num}`));
export const getRecording = (id, num) => tx('recordings', 'readonly', (s) => s.get(`${id}:${num}`));

// 학생 정보·동의 기록. 기기마다 한 명(id: 'me')이에요.
export const getProfile = () => tx('profile', 'readonly', (s) => s.get('me')).catch(() => null);
export const putProfile = (p) => tx('profile', 'readwrite', (s) => s.put(structuredClone({ ...p, id: 'me' })));

// 동의 철회: 이 기기에 저장한 학생 정보·응시 기록·녹음·설정을 모두 지워요.
export async function clearAll() {
  for (const store of ['attempts', 'recordings', 'profile']) await tx(store, 'readwrite', (s) => s.clear());
  try { Object.keys(localStorage).filter((k) => k.startsWith('sl.')).forEach((k) => localStorage.removeItem(k)); } catch { /* 없음 */ }
}

export function getSetting(k, def) {
  try { const v = localStorage.getItem('sl.' + k); return v == null ? def : JSON.parse(v); } catch { return def; }
}
export function setSetting(k, v) {
  try { localStorage.setItem('sl.' + k, JSON.stringify(v)); } catch { /* 사생활 보호 모드 등 */ }
}
