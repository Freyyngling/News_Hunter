// sources.js - RSSソース・タブ管理

const Sources = {
  config: null,
  customTabs: [],
  rssSources: [],

  async init(config) {
    this.config = config;
    // LocalStorageのカスタムタブを読む。なければconfig.jsonのデフォルトを使う
    const saved = Storage.getCustomTabs();
    this.customTabs = saved ? saved : JSON.parse(JSON.stringify(config.defaultCustomTabs));
    // RSSソース一覧
    const savedSrc = Storage.getRssSources();
    this.rssSources = savedSrc ? savedSrc : JSON.parse(JSON.stringify(config.defaultRssSources));
  },

  getFixedTabs() { return this.config.fixedTabs; },
  getCustomTabs() { return this.customTabs; },
  getAllTabs() { return [...this.getFixedTabs(), ...this.customTabs]; },

  // タブのRSS URLリストを正規化して返す
  getTabRssUrls(tab) {
    // rssUrls配列が優先
    if (Array.isArray(tab.rssUrls) && tab.rssUrls.length > 0) return tab.rssUrls;
    // 単数形rssUrlにも対応
    if (tab.rssUrl) return [tab.rssUrl];
    return [];
  },

  addCustomTab(tab) {
    const id = 'custom_' + Date.now();
    // rssUrlsを必ず配列で正規化して保存
    const rssUrls = tab.rssUrls
      ? tab.rssUrls
      : (tab.rssUrl ? [tab.rssUrl] : []);
    const newTab = { ...tab, id, rssUrls, enabled: true };
    delete newTab.rssUrl; // 単数形は削除して統一
    this.customTabs.push(newTab);
    Storage.setCustomTabs(this.customTabs);
    return id;
  },

  removeCustomTab(id) {
    this.customTabs = this.customTabs.filter(t => t.id !== id);
    Storage.setCustomTabs(this.customTabs);
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

  // LocalStorageを完全リセットしてconfigのデフォルトに戻す
  resetToDefaults() {
    Storage.remove('customTabs');
    Storage.remove('rssSources');
    this.customTabs = JSON.parse(JSON.stringify(this.config.defaultCustomTabs));
    this.rssSources = JSON.parse(JSON.stringify(this.config.defaultRssSources));
  },
};
