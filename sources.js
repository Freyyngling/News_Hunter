// sources.js - RSSソース・タブ管理

const Sources = {
  config: null,
  customTabs: [],
  rssSources: [],

  async init(config) {
    this.config = config;
    // カスタムタブ
    this.customTabs = Storage.getCustomTabs() || JSON.parse(JSON.stringify(config.defaultCustomTabs));
    // RSSソース
    this.rssSources = Storage.getRssSources() || JSON.parse(JSON.stringify(config.defaultRssSources));
  },

  getFixedTabs() { return this.config.fixedTabs; },
  getCustomTabs() { return this.customTabs; },
  getAllTabs() { return [...this.getFixedTabs(), ...this.customTabs]; },

  addCustomTab(tab) {
    const id = 'custom_' + Date.now();
    this.customTabs.push({ ...tab, id, enabled: true });
    Storage.setCustomTabs(this.customTabs);
    return id;
  },

  removeCustomTab(id) {
    this.customTabs = this.customTabs.filter(t => t.id !== id);
    Storage.setCustomTabs(this.customTabs);
  },

  updateCustomTab(id, data) {
    const idx = this.customTabs.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.customTabs[idx] = { ...this.customTabs[idx], ...data };
      Storage.setCustomTabs(this.customTabs);
    }
  },

  getRssSources() { return this.rssSources; },

  addRssSource(source) {
    const id = 'rss_' + Date.now();
    this.rssSources.push({ ...source, id, enabled: true });
    Storage.setRssSources(this.rssSources);
    return id;
  },

  removeRssSource(id) {
    this.rssSources = this.rssSources.filter(s => s.id !== id);
    Storage.setRssSources(this.rssSources);
  },

  toggleRssSource(id) {
    const s = this.rssSources.find(s => s.id === id);
    if (s) {
      s.enabled = !s.enabled;
      Storage.setRssSources(this.rssSources);
    }
  },

  // Google News キーワードRSS URL生成
  buildKeywordRssUrl(keyword) {
    const q = encodeURIComponent(keyword);
    return `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
  },

  // タブのRSS URLを取得
  getTabRssUrl(tab) {
    if (tab.rssUrl) return tab.rssUrl;
    if (tab.type === 'keyword' && tab.keyword) return this.buildKeywordRssUrl(tab.keyword);
    if (tab.type === 'rss' && tab.rssUrl) return tab.rssUrl;
    return null;
  },
};
