// sources.js
const Sources = {
  config: null,
  sourceGroups: [], // 全ソースグループ（固定＋カスタム）

  async init(config) {
    this.config = config;

    // バージョン管理：config更新時はLocalStorageのグループ設定をリセット
    const savedVer = localStorage.getItem('freyNewsHunter_configVer');
    if (savedVer !== config.configVersion) {
      Storage.remove('sourceGroups');
      localStorage.setItem('freyNewsHunter_configVer', config.configVersion);
    }

    const saved = Storage.get('sourceGroups');
    this.sourceGroups = saved || JSON.parse(JSON.stringify(config.sourceGroups));
  },

  getGroups() { return this.sourceGroups; },

  getGroup(groupId) {
    return this.sourceGroups.find(g => g.id === groupId) || null;
  },

  getCategory(groupId, catId) {
    const g = this.getGroup(groupId);
    return g ? (g.categories.find(c => c.id === catId) || null) : null;
  },

  // カテゴリのRSS URLを返す
  getCatRssUrl(cat) {
    return cat.rssUrl || '';
  },

  // ソースグループ追加
  addGroup(label, color) {
    const id = 'grp_' + Date.now();
    const group = { id, label, color: color || '#6366f1', categories: [] };
    this.sourceGroups.push(group);
    this._save();
    return id;
  },

  // ソースグループ削除
  removeGroup(groupId) {
    this.sourceGroups = this.sourceGroups.filter(g => g.id !== groupId);
    this._save();
  },

  // カテゴリ追加
  addCategory(groupId, label, rssUrl, keyword) {
    const g = this.getGroup(groupId);
    if (!g) return null;
    const id = 'cat_' + Date.now();
    g.categories.push({ id, label, rssUrl, keyword: keyword || '' });
    this._save();
    return id;
  },

  // カテゴリ更新
  updateCategory(groupId, catId, data) {
    const cat = this.getCategory(groupId, catId);
    if (cat) {
      Object.assign(cat, data);
      this._save();
      // キャッシュも削除
      Storage.removeCache(catId);
    }
  },

  // カテゴリ削除
  removeCategory(groupId, catId) {
    const g = this.getGroup(groupId);
    if (g) {
      g.categories = g.categories.filter(c => c.id !== catId);
      this._save();
      Storage.removeCache(catId);
    }
  },

  // 全リセット
  resetAll() {
    this.sourceGroups = JSON.parse(JSON.stringify(this.config.sourceGroups));
    this._save();
    localStorage.setItem('freyNewsHunter_configVer', this.config.configVersion);
  },

  _save() {
    Storage.set('sourceGroups', this.sourceGroups);
  },
};
