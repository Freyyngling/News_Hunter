// sources.js
// configバージョンが変わったらLocalStorageを自動リセットする仕組み付き

const CONFIG_VERSION = '2025-06-17-v2'; // config.jsonを変えたらここも変える

const Sources = {
  config: null,
  fixedTabs: [],
  customTabs: [],
  rssSources: [],

  async init(config) {
    this.config = config;

    // バージョンチェック：configが更新されていたらLocalStorageの固定タブをリセット
    const savedVersion = localStorage.getItem('freyNewsHunter_configVersion');
    if (savedVersion !== CONFIG_VERSION) {
      // 固定タブとRSSソース候補だけリセット（カスタムタブは維持）
      Storage.remove('fixedTabs');
      Storage.remove('rssSources');
      localStorage.setItem('freyNewsHunter_configVersion', CONFIG_VERSION);
      console.log('[Sources] config更新検出 → fixedTabs・rssSources をリセット');
    }

    // 固定タブ
    const savedFixed = Storage.get('fixedTabs');
    this.fixedTabs = savedFixed || JSON.parse(JSON.stringify(config.fixedTabs));

    // カスタムタブ
    const savedCustom = Storage.get('customTabs');
    this.customTabs = savedCustom || JSON.parse(JSON.stringify(config.defaultCustomTabs));

    // RSSソース候補
    const savedSrc = Storage.get('rssSources');
    this.rssSources = savedSrc || JSON.parse(JSON.stringify(config.defaultRssSources));
  },

  getFixedTabs()  { return this.fixedTabs; },
  getCustomTabs() { return this.customTabs; },
  getAllTabs()     { return [...this.fixedTabs, ...this.customTabs]; },

  getTabRssUrls(tab) {
    if (Array.isArray(tab.rssUrls) && tab.rssUrls.length > 0) return tab.rssUrls;
    if (tab.rssUrl) return [tab.rssUrl];
    return [];
  },

  // 固定タブのURL更新
  updateFixedTabUrls(tabId, urls) {
    const tab = this.fixedTabs.find(t => t.id === tabId);
    if (tab) {
      tab.rssUrls = urls.filter(u => u.trim());
      Storage.set('fixedTabs', this.fixedTabs);
      console.log(`[Sources] fixedTab ${tabId} saved:`, tab.rssUrls);
    }
  },

  // カスタムタブ追加
  addCustomTab(name, icon, color, rssUrls, keyword) {
    const id = 'custom_' + Date.now();
    const tab = {
      id, label: `${icon} ${name}`, icon, color,
      rssUrls: rssUrls.filter(u => u.trim()),
      keyword: keyword || '',
      type: 'rss',
    };
    this.customTabs.push(tab);
    Storage.set('customTabs', this.customTabs);
    return id;
  },

  // カスタムタブのURL・キーワード更新
  updateCustomTabUrls(tabId, urls, keyword) {
    const tab = this.customTabs.find(t => t.id === tabId);
    if (tab) {
      tab.rssUrls = urls.filter(u => u.trim());
      if (keyword !== undefined) tab.keyword = keyword;
      Storage.set('customTabs', this.customTabs);
      console.log(`[Sources] customTab ${tabId} saved:`, tab.rssUrls);
    }
  },

  // カスタムタブ削除
  removeCustomTab(id) {
    this.customTabs = this.customTabs.filter(t => t.id !== id);
    Storage.set('customTabs', this.customTabs);
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

  // 全設定をconfigの初期値に完全リセット
  resetAll() {
    this.fixedTabs  = JSON.parse(JSON.stringify(this.config.fixedTabs));
    this.customTabs = JSON.parse(JSON.stringify(this.config.defaultCustomTabs));
    this.rssSources = JSON.parse(JSON.stringify(this.config.defaultRssSources));
    Storage.set('fixedTabs',  this.fixedTabs);
    Storage.set('customTabs', this.customTabs);
    Storage.set('rssSources', this.rssSources);
    localStorage.setItem('freyNewsHunter_configVersion', CONFIG_VERSION);
    console.log('[Sources] resetAll完了');
  },
};
