// sources.js - RSSソース・タブ管理

const Sources = {
  config: null,
  customTabs: [],
  rssSources: [],

  async init(config) {
    this.config = config;
    this.customTabs = Storage.getCustomTabs() || JSON.parse(JSON.stringify(config.defaultCustomTabs));
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

  // タブのRSS URLリストを取得（複数対応）
  getTabRssUrls(tab) {
    if (tab.rssUrls && tab.rssUrls.length > 0) return tab.rssUrls;
    if (tab.rssUrl) return [tab.rssUrl];
    return [];
  },
};
