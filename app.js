// app.js - メインロジック

const App = {
  config: null,
  currentTabId: null,
  currentView: 'card', // 'card' or 'list'
  fetchCount: 20,
  isLoading: false,

  async init() {
    const res = await fetch('config.json');
    this.config = await res.json();
    await Sources.init(this.config);
    this.fetchCount = Storage.getSettings().fetchCount || this.config.defaultFetchCount;

    this.renderTabs();
    this.bindEvents();
    this.applyBackground();
    this.updateFetchCountInput();

    // 最初のタブを選択
    const firstTab = this.config.fixedTabs[0];
    this.selectTab(firstTab.id);
  },

  // タブ描画
  renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    tabBar.innerHTML = '';

    const allTabs = Sources.getAllTabs();
    allTabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-icon">${tab.icon || '📰'}</span><span class="tab-label">${tab.label}</span>`;
      btn.style.setProperty('--tab-color', tab.color || '#3b82f6');
      btn.addEventListener('click', () => this.selectTab(tab.id));
      tabBar.appendChild(btn);
    });

    // ブックマークタブ
    const bmBtn = document.createElement('button');
    bmBtn.className = 'tab-btn tab-bookmark';
    bmBtn.dataset.tabId = '__bookmarks__';
    bmBtn.innerHTML = `<span class="tab-icon">🔖</span><span class="tab-label">ブックマーク</span>`;
    bmBtn.style.setProperty('--tab-color', '#f59e0b');
    bmBtn.addEventListener('click', () => this.selectTab('__bookmarks__'));
    tabBar.appendChild(bmBtn);

    // カスタムタブ追加ボタン
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-btn tab-add';
    addBtn.innerHTML = `<span class="tab-icon">＋</span><span class="tab-label">タブ追加</span>`;
    addBtn.addEventListener('click', () => this.showAddTabModal());
    tabBar.appendChild(addBtn);
  },

  selectTab(tabId) {
    this.currentTabId = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tabId === tabId);
    });

    if (tabId === '__bookmarks__') {
      this.renderBookmarks();
      return;
    }

    // キャッシュがあればまず表示
    const cached = Storage.getCached(tabId);
    if (cached) {
      this.renderArticles(cached.data, tabId);
      const ts = new Date(cached.timestamp).toLocaleString('ja-JP');
      this.setStatus(`前回取得: ${ts}`);
    } else {
      this.showSkeleton();
      this.fetchArticles(tabId);
    }
  },

  // RSS取得（複数APIフォールバック）
  async fetchArticles(tabId) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFetchBtnLoading(true);
    this.showSkeleton();

    const allTabs = Sources.getAllTabs();
    const tab = allTabs.find(t => t.id === tabId);
    if (!tab) { this.isLoading = false; return; }

    const rssUrl = Sources.getTabRssUrl(tab);
    if (!rssUrl) { this.isLoading = false; return; }

    const items = await this.fetchRssWithFallback(rssUrl);

    if (items && items.length > 0) {
      const sliced = items.slice(0, this.fetchCount);
      Storage.setCache(tabId, sliced);
      this.renderArticles(sliced, tabId);
      const ts = new Date().toLocaleString('ja-JP');
      this.setStatus(`取得: ${ts}　${sliced.length}件`);
    } else {
      this.showError('記事の取得に失敗しました。しばらく待ってから再度お試しください。');
    }

    this.isLoading = false;
    this.setFetchBtnLoading(false);
  },

  // 複数APIを順番に試すフォールバック
  async fetchRssWithFallback(rssUrl) {
    // 方法1: rss2json.com
    try {
      const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=100`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'ok' && data.items && data.items.length > 0) {
        return this.normalizeRss2json(data.items);
      }
    } catch(e) {}

    // 方法2: AllOrigins経由でRSS直接取得＋パース
    try {
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
      const res = await fetch(proxy);
      const data = await res.json();
      if (data.contents) {
        const items = this.parseRssXml(data.contents);
        if (items && items.length > 0) return items;
      }
    } catch(e) {}

    // 方法3: corsproxy.io経由
    try {
      const proxy = `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`;
      const res = await fetch(proxy);
      const text = await res.text();
      if (text) {
        const items = this.parseRssXml(text);
        if (items && items.length > 0) return items;
      }
    } catch(e) {}

    return null;
  },

  // rss2json形式を内部形式に正規化
  normalizeRss2json(items) {
    return items.map(item => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      author: item.author || '',
      thumbnail: item.thumbnail || item.enclosure?.link || '',
      description: item.description || item.content || '',
      source: { title: item.author || '' },
      enclosure: item.enclosure || {},
    }));
  },

  // RSS/AtomのXMLを手動パース
  parseRssXml(xmlText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const items = [];

      // RSS 2.0
      const rssItems = doc.querySelectorAll('item');
      if (rssItems.length > 0) {
        rssItems.forEach(el => {
          const get = (tag) => el.querySelector(tag)?.textContent?.trim() || '';
          const link = get('link') || el.querySelector('guid')?.textContent?.trim() || '';
          let imgUrl = '';
          const enclosure = el.querySelector('enclosure');
          if (enclosure && enclosure.getAttribute('type')?.startsWith('image')) {
            imgUrl = enclosure.getAttribute('url') || '';
          }
          if (!imgUrl) {
            const media = el.querySelector('content') || el.querySelector('thumbnail');
            if (media) imgUrl = media.getAttribute('url') || '';
          }
          if (!imgUrl) {
            const desc = get('description') || get('encoded');
            const match = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (match) imgUrl = match[1];
          }
          items.push({
            title: get('title'),
            link,
            pubDate: get('pubDate'),
            author: get('author') || get('creator') || '',
            thumbnail: imgUrl,
            description: get('description') || get('encoded') || '',
            source: { title: get('source') || '' },
            enclosure: {},
          });
        });
        return items;
      }

      // Atom
      const entries = doc.querySelectorAll('entry');
      entries.forEach(el => {
        const get = (tag) => el.querySelector(tag)?.textContent?.trim() || '';
        const linkEl = el.querySelector('link[rel="alternate"]') || el.querySelector('link');
        const link = linkEl?.getAttribute('href') || '';
        items.push({
          title: get('title'),
          link,
          pubDate: get('updated') || get('published') || '',
          author: el.querySelector('author name')?.textContent?.trim() || '',
          thumbnail: '',
          description: get('summary') || get('content') || '',
          source: { title: '' },
          enclosure: {},
        });
      });
      return items;
    } catch(e) {
      return [];
    }
  },

  // 記事描画
  renderArticles(items, tabId) {
    const container = document.getElementById('articles-container');
    container.innerHTML = '';

    const allTabs = Sources.getAllTabs();
    const tab = allTabs.find(t => t.id === tabId);
    const tabColor = tab?.color || '#3b82f6';

    if (!items || items.length === 0) {
      container.innerHTML = '<div class="no-articles">記事が見つかりませんでした。</div>';
      return;
    }

    items.forEach((item, idx) => {
      const articleId = btoa(encodeURIComponent(item.link || item.title || idx)).slice(0, 32);
      const isRead = Storage.isRead(articleId);
      const isBookmarked = Storage.isBookmarked(articleId);

      // 画像取得
      let imgUrl = item.enclosure?.link || item.thumbnail || '';
      if (!imgUrl && item.description) {
        const match = item.description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match) imgUrl = match[1];
      }

      const pubDate = item.pubDate ? new Date(item.pubDate).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const source = item.source?.title || item.author || '';

      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''} ${isRead ? 'is-read' : ''}`;
      card.style.setProperty('--card-color', tabColor);
      card.style.animationDelay = `${idx * 0.04}s`;

      card.innerHTML = `
        <div class="card-thumb">
          ${imgUrl
            ? `<img src="${imgUrl}" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-img')">`
            : `<div class="thumb-placeholder" style="background: linear-gradient(135deg, ${tabColor}44, ${tabColor}22)"><span>${tab?.icon || '📰'}</span></div>`
          }
          ${isRead ? '' : '<span class="badge-new">NEW</span>'}
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="card-source">${source}</span>
            <span class="card-date">${pubDate}</span>
          </div>
          <h3 class="card-title">${item.title || '(タイトルなし)'}</h3>
          <div class="card-actions">
            <button class="btn-open" data-url="${item.link}" title="記事を開く">🔗 開く</button>
            <button class="btn-bookmark ${isBookmarked ? 'bookmarked' : ''}" data-id="${articleId}" data-article='${JSON.stringify({ id: articleId, title: item.title, link: item.link, pubDate: item.pubDate, source }).replace(/'/g, "&#39;")}' title="ブックマーク">
              ${isBookmarked ? '🔖' : '🔖'}
            </button>
          </div>
        </div>
      `;

      // 開くボタン
      card.querySelector('.btn-open').addEventListener('click', (e) => {
        e.stopPropagation();
        Storage.markRead(articleId);
        card.classList.add('is-read');
        card.querySelector('.badge-new')?.remove();
        window.open(item.link, '_blank');
      });

      // ブックマークボタン
      card.querySelector('.btn-bookmark').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const artData = JSON.parse(btn.dataset.article.replace(/&#39;/g, "'"));
        if (Storage.isBookmarked(articleId)) {
          Storage.removeBookmark(articleId);
          btn.classList.remove('bookmarked');
        } else {
          Storage.addBookmark(artData);
          btn.classList.add('bookmarked');
        }
      });

      container.appendChild(card);
    });
  },

  renderBookmarks() {
    const container = document.getElementById('articles-container');
    container.innerHTML = '';
    const bookmarks = Storage.getBookmarks();
    this.setStatus(`ブックマーク: ${bookmarks.length}件`);

    if (bookmarks.length === 0) {
      container.innerHTML = '<div class="no-articles">ブックマークはまだありません。</div>';
      return;
    }

    bookmarks.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''}`;
      card.style.setProperty('--card-color', '#f59e0b');
      card.style.animationDelay = `${idx * 0.04}s`;
      card.innerHTML = `
        <div class="card-thumb">
          <div class="thumb-placeholder" style="background: linear-gradient(135deg, #f59e0b44, #f59e0b22)"><span>🔖</span></div>
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="card-source">${item.source || ''}</span>
            <span class="card-date">${item.pubDate ? new Date(item.pubDate).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric' }) : ''}</span>
          </div>
          <h3 class="card-title">${item.title || ''}</h3>
          <div class="card-actions">
            <button class="btn-open" data-url="${item.link}">🔗 開く</button>
            <button class="btn-remove-bm" data-id="${item.id}">🗑️ 削除</button>
          </div>
        </div>
      `;
      card.querySelector('.btn-open').addEventListener('click', () => window.open(item.link, '_blank'));
      card.querySelector('.btn-remove-bm').addEventListener('click', () => {
        Storage.removeBookmark(item.id);
        card.remove();
      });
      container.appendChild(card);
    });
  },

  showSkeleton() {
    const container = document.getElementById('articles-container');
    container.innerHTML = Array.from({ length: 6 }, () => `
      <div class="article-card skeleton">
        <div class="card-thumb"><div class="skel-img"></div></div>
        <div class="card-body">
          <div class="skel-line short"></div>
          <div class="skel-line"></div>
          <div class="skel-line"></div>
          <div class="skel-line mid"></div>
        </div>
      </div>
    `).join('');
  },

  showError(msg) {
    document.getElementById('articles-container').innerHTML = `<div class="no-articles error">${msg}</div>`;
  },

  setStatus(msg) {
    document.getElementById('status-bar').textContent = msg;
  },

  setFetchBtnLoading(loading) {
    const btn = document.getElementById('btn-fetch');
    btn.disabled = loading;
    btn.textContent = loading ? '取得中...' : '🔄 今すぐ取得';
  },

  // 表示切り替え
  toggleView() {
    this.currentView = this.currentView === 'card' ? 'list' : 'card';
    document.getElementById('btn-view').textContent = this.currentView === 'card' ? '☰ リスト' : '⊞ カード';
    const cached = Storage.getCached(this.currentTabId);
    if (cached) this.renderArticles(cached.data, this.currentTabId);
  },

  updateFetchCountInput() {
    document.getElementById('fetch-count').value = this.fetchCount;
  },

  // 背景適用
  applyBackground() {
    const setting = Storage.getBgSetting();
    const bgLayer = document.getElementById('bg-layer');
    const bgVideo = document.getElementById('bg-video');

    bgLayer.style.backgroundImage = '';
    bgVideo.style.display = 'none';
    bgVideo.src = '';

    if (setting.type === 'image') {
      bgLayer.style.backgroundImage = `url('${setting.value}')`;
      bgLayer.style.backgroundSize = `${setting.zoom || 100}%`;
      bgLayer.style.backgroundPosition = 'center top';
      bgLayer.style.backgroundRepeat = 'no-repeat';
    } else if (setting.type === 'video') {
      bgVideo.src = setting.value;
      bgVideo.style.display = 'block';
      bgVideo.style.transform = `scale(${(setting.zoom || 100) / 100})`;
    } else if (setting.type === 'upload') {
      const data = Storage.getUploadedBg();
      if (data) {
        bgLayer.style.backgroundImage = `url('${data}')`;
        bgLayer.style.backgroundSize = `${setting.zoom || 100}%`;
        bgLayer.style.backgroundPosition = 'center top';
        bgLayer.style.backgroundRepeat = 'no-repeat';
      }
    }
  },

  setBg(type, value, zoom) {
    const z = zoom !== undefined ? zoom : (Storage.getBgSetting().zoom || 100);
    Storage.setBgSetting({ type, value, zoom: z });
    this.applyBackground();
  },

  // モーダル：タブ追加
  showAddTabModal() {
    document.getElementById('modal-add-tab').classList.add('open');
  },

  hideAddTabModal() {
    document.getElementById('modal-add-tab').classList.remove('open');
    document.getElementById('new-tab-name').value = '';
    document.getElementById('new-tab-keyword').value = '';
  },

  saveNewTab() {
    const name = document.getElementById('new-tab-name').value.trim();
    const keyword = document.getElementById('new-tab-keyword').value.trim();
    if (!name || !keyword) return;

    const icons = ['📌', '🔍', '💡', '🌐', '📡', '🧩', '⭐', '🔥'];
    const icon = icons[Math.floor(Math.random() * icons.length)];
    const colors = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    Sources.addCustomTab({ label: `${icon} ${name}`, icon, type: 'keyword', keyword, color });
    this.renderTabs();
    this.hideAddTabModal();
    this.selectTab(Sources.getCustomTabs().slice(-1)[0].id);
  },

  // モーダル：設定
  showSettingsModal() {
    this.renderRssSourcesList();
    this.renderCustomTabsList();
    document.getElementById('modal-settings').classList.add('open');
  },

  hideSettingsModal() {
    document.getElementById('modal-settings').classList.remove('open');
  },

  renderRssSourcesList() {
    const list = document.getElementById('rss-sources-list');
    list.innerHTML = '';
    Sources.getRssSources().forEach(s => {
      const row = document.createElement('div');
      row.className = 'source-row';
      row.innerHTML = `
        <input type="checkbox" ${s.enabled ? 'checked' : ''} data-id="${s.id}">
        <span class="source-name">${s.name}</span>
        <span class="source-url">${s.url}</span>
        <button class="btn-del-source" data-id="${s.id}">🗑️</button>
      `;
      row.querySelector('input').addEventListener('change', () => Sources.toggleRssSource(s.id));
      row.querySelector('.btn-del-source').addEventListener('click', () => {
        Sources.removeRssSource(s.id);
        this.renderRssSourcesList();
      });
      list.appendChild(row);
    });
  },

  addRssSource() {
    const name = document.getElementById('new-rss-name').value.trim();
    const url = document.getElementById('new-rss-url').value.trim();
    if (!name || !url) return;
    Sources.addRssSource({ name, url });
    document.getElementById('new-rss-name').value = '';
    document.getElementById('new-rss-url').value = '';
    this.renderRssSourcesList();
  },

  renderCustomTabsList() {
    const list = document.getElementById('custom-tabs-list');
    list.innerHTML = '';
    Sources.getCustomTabs().forEach(tab => {
      const row = document.createElement('div');
      row.className = 'source-row';
      row.innerHTML = `
        <span class="tab-icon-sm">${tab.icon || '📌'}</span>
        <span class="source-name">${tab.label}</span>
        <span class="source-url">${tab.keyword || tab.rssUrl || ''}</span>
        <button class="btn-del-source" data-id="${tab.id}">🗑️</button>
      `;
      row.querySelector('.btn-del-source').addEventListener('click', () => {
        Sources.removeCustomTab(tab.id);
        this.renderTabs();
        this.renderCustomTabsList();
      });
      list.appendChild(row);
    });
  },

  // 背景設定
  showBgModal() {
    document.getElementById('modal-bg').classList.add('open');
    this.renderBgThumbs();
    const setting = Storage.getBgSetting();
    document.getElementById('bg-zoom-slider').value = setting.zoom || 100;
    document.getElementById('bg-zoom-value').textContent = (setting.zoom || 100) + '%';
  },

  hideBgModal() {
    document.getElementById('modal-bg').classList.remove('open');
  },

  renderBgThumbs() {
    const container = document.getElementById('bg-thumbs');
    container.innerHTML = '';

    // なし
    const noneBtn = document.createElement('div');
    noneBtn.className = 'bg-thumb';
    noneBtn.textContent = 'なし';
    noneBtn.addEventListener('click', () => this.setBg('none', null));
    container.appendChild(noneBtn);

    // 固定背景
    this.config.backgrounds.forEach(bg => {
      const div = document.createElement('div');
      div.className = 'bg-thumb';
      if (bg.type === 'video') {
        div.innerHTML = `<video src="${bg.file}" muted loop autoplay style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></video><span class="bg-label">${bg.label}</span>`;
      } else {
        div.style.backgroundImage = `url('${bg.file}')`;
        div.style.backgroundSize = 'cover';
        div.style.backgroundPosition = 'center';
        div.innerHTML = `<span class="bg-label">${bg.label}</span>`;
      }
      div.addEventListener('click', () => this.setBg(bg.type, bg.file));
      container.appendChild(div);
    });
  },

  handleBgUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      Storage.setUploadedBg(ev.target.result);
      this.setBg('upload', null);
    };
    reader.readAsDataURL(file);
  },

  bindEvents() {
    // 取得ボタン
    document.getElementById('btn-fetch').addEventListener('click', () => {
      if (this.currentTabId && this.currentTabId !== '__bookmarks__') {
        this.fetchArticles(this.currentTabId);
      }
    });

    // 表示切り替え
    document.getElementById('btn-view').addEventListener('click', () => this.toggleView());

    // 設定ボタン
    document.getElementById('btn-settings').addEventListener('click', () => this.showSettingsModal());

    // 背景ボタン
    document.getElementById('btn-bg').addEventListener('click', () => this.showBgModal());

    // 取得件数
    document.getElementById('fetch-count').addEventListener('change', (e) => {
      const v = parseInt(e.target.value) || 20;
      this.fetchCount = Math.max(1, Math.min(200, v));
      e.target.value = this.fetchCount;
      Storage.saveSetting('fetchCount', this.fetchCount);
    });

    // モーダル閉じる
    document.getElementById('modal-add-tab').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hideAddTabModal();
    });
    document.getElementById('modal-settings').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hideSettingsModal();
    });
    document.getElementById('modal-bg').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hideBgModal();
    });

    document.getElementById('btn-save-tab').addEventListener('click', () => this.saveNewTab());
    document.getElementById('btn-cancel-tab').addEventListener('click', () => this.hideAddTabModal());
    document.getElementById('btn-close-settings').addEventListener('click', () => this.hideSettingsModal());
    document.getElementById('btn-close-bg').addEventListener('click', () => this.hideBgModal());
    document.getElementById('btn-add-rss').addEventListener('click', () => this.addRssSource());

    // 背景ズームスライダー
    document.getElementById('bg-zoom-slider').addEventListener('input', (e) => {
      const z = parseInt(e.target.value);
      document.getElementById('bg-zoom-value').textContent = z + '%';
      const setting = Storage.getBgSetting();
      setting.zoom = z;
      Storage.setBgSetting(setting);
      this.applyBackground();
    });

    // 背景アップロード
    document.getElementById('bg-upload-input').addEventListener('change', (e) => this.handleBgUpload(e));
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
