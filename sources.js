// sources.js

const Sources = {
  config: null,
  fixedTabs: [],   // 固定タブ（編集可能、LocalStorageに保存）
  customTabs: [],  // カスタムタブ（追加・削除可能）
  rssSources: [],  // RSSソース候補一覧

  async init(config) {
    this.config = config;

    // 固定タブ：LocalStorageに保存済みがあればそれを使う、なければconfig.jsonから初期化
    const savedFixed = Storage.get('fixedTabs');
    this.fixedTabs = savedFixed || JSON.parse(JSON.stringify(config.fixedTabs));

    // カスタムタブ：同様
    const savedCustom = Storage.get('customTabs');
    this.customTabs = savedCustom || JSON.parse(JSON.stringify(config.defaultCustomTabs));

    // RSSソース候補
    const savedSrc = Storage.get('rssSources');
    this.rssSources = savedSrc || JSON.parse(JSON.stringify(config.defaultRssSources));
  },

  getFixedTabs() { return this.fixedTabs; },
  getCustomTabs() { return this.customTabs; },
  getAllTabs() { return [...this.fixedTabs, ...this.customTabs]; },

  // 固定タブのRSS URLを更新して保存
  updateFixedTabUrls(tabId, urls) {
    const tab = this.fixedTabs.find(t => t.id === tabId);
    if (tab) {
      tab.rssUrls = urls.filter(u => u.trim());
      Storage.set('fixedTabs', this.fixedTabs);
    }
  },

  // カスタムタブ追加
  addCustomTab(name, icon, color, rssUrls, keyword) {
    const id = 'custom_' + Date.now();
    const tab = {
      id,
      label: `${icon} ${name}`,
      icon,
      color,
      rssUrls: rssUrls.filter(u => u.trim()),
      keyword: keyword || '',
      type: 'rss',
    };
    this.customTabs.push(tab);
    Storage.set('customTabs', this.customTabs);
    return id;
  },

  // カスタムタブのRSS URL更新
  updateCustomTabUrls(tabId, urls, keyword) {
    const tab = this.customTabs.find(t => t.id === tabId);
    if (tab) {
      tab.rssUrls = urls.filter(u => u.trim());
      if (keyword !== undefined) tab.keyword = keyword;
      Storage.set('customTabs', this.customTabs);
    }
  },

  // カスタムタブ削除
  removeCustomTab(id) {
    this.customTabs = this.customTabs.filter(t => t.id !== id);
    Storage.set('customTabs', this.customTabs);
  },

  // タブのRSS URLリストを返す
  getTabRssUrls(tab) {
    if (Array.isArray(tab.rssUrls) && tab.rssUrls.length > 0) return tab.rssUrls;
    if (tab.rssUrl) return [tab.rssUrl];
    return [];
  },

  // RSSソース候補管理
  getRssSources() { return this.rssSources; },
  addRssSource(name, url) {
    const id = 'src_' + Date.now();
    this.rssSources.push({ id, name, url });
    Storage.set('rssSources', this.rssSources);
  },
  removeRssSource(id) {
    this.rssSources = this.rssSources.filter(s => s.id !== id);
    Storage.set('rssSources', this.rssSources);
  },

  // 全設定をconfigの初期値に戻す
  resetAll() {
    this.fixedTabs = JSON.parse(JSON.stringify(this.config.fixedTabs));
    this.customTabs = JSON.parse(JSON.stringify(this.config.defaultCustomTabs));
    this.rssSources = JSON.parse(JSON.stringify(this.config.defaultRssSources));
    Storage.set('fixedTabs', this.fixedTabs);
    Storage.set('customTabs', this.customTabs);
    Storage.set('rssSources', this.rssSources);
  },
};
