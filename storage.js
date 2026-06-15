// storage.js - LocalStorage管理

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

  remove(key) {
    localStorage.removeItem(this.PREFIX + key);
  },

  // 既読管理
  getRead() { return this.get('read') || {}; },
  markRead(articleId) {
    const read = this.getRead();
    read[articleId] = Date.now();
    this.set('read', read);
  },
  isRead(articleId) { return !!this.getRead()[articleId]; },

  // ブックマーク
  getBookmarks() { return this.get('bookmarks') || []; },
  addBookmark(article) {
    const bm = this.getBookmarks();
    if (!bm.find(a => a.id === article.id)) {
      bm.unshift(article);
      this.set('bookmarks', bm.slice(0, 200));
    }
  },
  removeBookmark(articleId) {
    const bm = this.getBookmarks().filter(a => a.id !== articleId);
    this.set('bookmarks', bm);
  },
  isBookmarked(articleId) { return !!this.getBookmarks().find(a => a.id === articleId); },

  // キャッシュ（タブごとの取得済み記事）
  getCached(tabId) { return this.get('cache_' + tabId) || null; },
  setCache(tabId, data) {
    this.set('cache_' + tabId, { data, timestamp: Date.now() });
  },

  // カスタムタブ
  getCustomTabs() { return this.get('customTabs') || null; },
  setCustomTabs(tabs) { this.set('customTabs', tabs); },

  // RSSソース
  getRssSources() { return this.get('rssSources') || null; },
  setRssSources(sources) { this.set('rssSources', sources); },

  // 設定
  getSettings() { return this.get('settings') || {}; },
  saveSetting(key, value) {
    const s = this.getSettings();
    s[key] = value;
    this.set('settings', s);
  },

  // 背景
  getBgSetting() { return this.get('bgSetting') || { type: 'none', value: null, zoom: 100 }; },
  setBgSetting(setting) { this.set('bgSetting', setting); },

  // アップロード背景画像（base64）
  getUploadedBg() { return this.get('uploadedBg') || null; },
  setUploadedBg(base64) { this.set('uploadedBg', base64); },
};
