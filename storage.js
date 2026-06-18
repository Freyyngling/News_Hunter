// storage.js
const Storage = {
  PREFIX: 'freyNewsHunter_',

  get(key) {
    try {
      const val = localStorage.getItem(this.PREFIX + key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },

  set(key, value) {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
      return true;
    } catch { return false; }
  },

  remove(key) { localStorage.removeItem(this.PREFIX + key); },

  // 既読
  getRead() { return this.get('read') || {}; },
  markRead(id) {
    const r = this.getRead(); r[id] = Date.now(); this.set('read', r);
  },
  isRead(id) { return !!this.getRead()[id]; },

  // ブックマーク
  getBookmarks() { return this.get('bookmarks') || []; },
  addBookmark(article) {
    const bm = this.getBookmarks();
    if (!bm.find(a => a.id === article.id)) {
      bm.unshift(article); this.set('bookmarks', bm.slice(0, 200));
    }
  },
  removeBookmark(id) { this.set('bookmarks', this.getBookmarks().filter(a => a.id !== id)); },
  isBookmarked(id) { return !!this.getBookmarks().find(a => a.id === id); },

  // キャッシュ
  getCached(key) { return this.get('cache_' + key) || null; },
  setCache(key, data) { this.set('cache_' + key, { data, timestamp: Date.now() }); },
  removeCache(key) { this.remove('cache_' + key); },

  // 設定
  getSettings() { return this.get('settings') || {}; },
  saveSetting(key, value) {
    const s = this.getSettings(); s[key] = value; this.set('settings', s);
  },

  // 背景
  getBgSetting() { return this.get('bgSetting') || { type: 'none', value: null, zoom: 100 }; },
  setBgSetting(s) { this.set('bgSetting', s); },
  getUploadedBg() { return this.get('uploadedBg') || null; },
  setUploadedBg(b64) { this.set('uploadedBg', b64); },
};
