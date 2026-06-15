// app.js - メインロジック

const App = {
  config: null,
  currentTabId: null,
  currentView: 'card',
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

    const firstTab = this.config.fixedTabs[0];
    this.selectTab(firstTab.id);
  },

  renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    tabBar.innerHTML = '';

    Sources.getAllTabs().forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-icon">${tab.icon || '📰'}</span><span class="tab-label">${tab.label}</span>`;
      btn.style.setProperty('--tab-color', tab.color || '#3b82f6');
      btn.addEventListener('click', () => this.selectTab(tab.id));
      tabBar.appendChild(btn);
    });

    const bmBtn = document.createElement('button');
    bmBtn.className = 'tab-btn tab-bookmark';
    bmBtn.dataset.tabId = '__bookmarks__';
    bmBtn.innerHTML = `<span class="tab-icon">🔖</span><span class="tab-label">ブックマーク</span>`;
    bmBtn.style.setProperty('--tab-color', '#f59e0b');
    bmBtn.addEventListener('click', () => this.selectTab('__bookmarks__'));
    tabBar.appendChild(bmBtn);

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

    const cached = Storage.getCached(tabId);
    if (cached) {
      this.renderArticles(cached.data, tabId);
      const ts = new Date(cached.timestamp).toLocaleString('ja-JP');
      this.setStatus(`前回取得: ${ts}　${cached.data.length}件`);
    } else {
      this.showSkeleton();
      this.setStatus('「今すぐ取得」ボタンを押してください');
    }
  },

  // メイン取得処理
  async fetchArticles(tabId) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFetchBtnLoading(true);
    this.showSkeleton();
    this.setStatus('取得中...');

    const allTabs = Sources.getAllTabs();
    const tab = allTabs.find(t => t.id === tabId);
    if (!tab) { this.isLoading = false; this.setFetchBtnLoading(false); return; }

    // タブ固有のURLのみ使う（RSSソース管理パネルは取得に影響しない）
    const allUrls = Sources.getTabRssUrls(tab);

    if (!allUrls || allUrls.length === 0) {
      this.showError('このタブにRSSが設定されていません。タブを削除して作り直してください。');
      this.isLoading = false;
      this.setFetchBtnLoading(false);
      return;
    }

    // 複数URLから並行取得してマージ
    let allItems = [];
    const keyword = tab.keyword || '';

    const results = await Promise.allSettled(
      allUrls.map(url => this.fetchSingleRss(url))
    );

    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
        allItems = allItems.concat(r.value);
      }
    });

    // キーワードフィルタ（カスタムタブのみ）
    if (keyword && tab.id.startsWith('custom_')) {
      const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = allItems.filter(item => {
        const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
        // いずれかのキーワードにマッチすればOK
        return keywords.some(kw => text.includes(kw));
      });
      // フィルタ結果が1件以上あれば適用（関係ない記事を混入させない）
      if (filtered.length > 0) allItems = filtered;
    }

    // 日付順ソート
    allItems.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate) : 0;
      const db = b.pubDate ? new Date(b.pubDate) : 0;
      return db - da;
    });

    // 重複除去（タイトルベース）
    const seen = new Set();
    allItems = allItems.filter(item => {
      const key = (item.title || '').trim().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sliced = allItems.slice(0, this.fetchCount);

    if (sliced.length > 0) {
      Storage.setCache(tabId, sliced);
      this.renderArticles(sliced, tabId);
      const ts = new Date().toLocaleString('ja-JP');
      const urlInfo = allUrls.map(u => {
        try { return new URL(u).hostname; } catch(e) { return u; }
      }).join(', ');
      this.setStatus(`取得: ${ts}　${sliced.length}件　ソース: ${urlInfo}`);
    } else {
      this.showError(`記事を取得できませんでした。URL: ${allUrls.join(', ')}`);
    }

    this.isLoading = false;
    this.setFetchBtnLoading(false);
  },

  // 単一RSSを複数プロキシでフォールバック取得
  async fetchSingleRss(rssUrl) {
    // プロキシリスト（順番に試す）
    const proxies = [
      async (url) => {
        const endpoint = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&count=50`;
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.status === 'ok' && data.items?.length > 0) {
          return data.items.map(item => ({
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate || '',
            author: item.author || '',
            thumbnail: item.thumbnail || item.enclosure?.link || '',
            description: item.description || item.content || '',
            source: { title: item.author || '' },
          }));
        }
        return null;
      },
      async (url) => {
        const endpoint = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.contents) return this.parseRssXml(data.contents);
        return null;
      },
      async (url) => {
        const endpoint = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        const text = await res.text();
        if (text) return this.parseRssXml(text);
        return null;
      },
    ];

    for (const proxy of proxies) {
      try {
        const items = await proxy(rssUrl);
        if (items && items.length > 0) return items;
      } catch(e) {
        // 次のプロキシを試す
      }
    }
    return [];
  },

  // RSS/AtomのXMLをパース
  parseRssXml(xmlText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const items = [];

      const rssItems = doc.querySelectorAll('item');
      if (rssItems.length > 0) {
        rssItems.forEach(el => {
          const get = (tag) => el.querySelector(tag)?.textContent?.trim() || '';
          const link = get('link') || el.querySelector('guid')?.textContent?.trim() || '';
          let imgUrl = '';
          const enclosure = el.querySelector('enclosure');
          if (enclosure?.getAttribute('type')?.startsWith('image')) {
            imgUrl = enclosure.getAttribute('url') || '';
          }
          if (!imgUrl) {
            const media = el.querySelector('[url]');
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
            description: get('description') || '',
            source: { title: '' },
          });
        });
        return items;
      }

      // Atom対応
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

      let imgUrl = item.thumbnail || item.enclosure?.link || '';
      if (!imgUrl && item.description) {
        const match = item.description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match) imgUrl = match[1];
      }

      const pubDate = item.pubDate
        ? new Date(item.pubDate).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      const source = item.source?.title || item.author || '';

      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''} ${isRead ? 'is-read' : ''}`;
      card.style.setProperty('--card-color', tabColor);
      card.style.animationDelay = `${idx * 0.04}s`;

      const safeArticle = JSON.stringify({
        id: articleId,
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source
      }).replace(/'/g, "&#39;");

      card.innerHTML = `
        <div class="card-thumb">
          ${imgUrl
            ? `<img src="${imgUrl}" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-img');this.remove();this.parentElement.innerHTML+='<div class=\\'thumb-placeholder\\" style=\\"background:linear-gradient(135deg,${tabColor}44,${tabColor}22)\\"><span>${tab?.icon || '📰'}</span></div>'">`
            : `<div class="thumb-placeholder" style="background:linear-gradient(135deg,${tabColor}44,${tabColor}22)"><span>${tab?.icon || '📰'}</span></div>`
          }
          ${!isRead ? '<span class="badge-new">NEW</span>' : ''}
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="card-source">${source}</span>
            <span class="card-date">${pubDate}</span>
          </div>
          <h3 class="card-title">${item.title || '(タイトルなし)'}</h3>
          <div class="card-actions">
            <button class="btn-open" data-url="${item.link}">🔗 開く</button>
            <button class="btn-bookmark ${isBookmarked ? 'bookmarked' : ''}" data-id="${articleId}" data-article='${safeArticle}'>🔖</button>
          </div>
        </div>
      `;

      card.querySelector('.btn-open').addEventListener('click', (e) => {
        e.stopPropagation();
        Storage.markRead(articleId);
        card.classList.add('is-read');
        card.querySelector('.badge-new')?.remove();
        window.open(item.link, '_blank');
      });

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
          <div class="thumb-placeholder" style="background:linear-gradient(135deg,#f59e0b44,#f59e0b22)"><span>🔖</span></div>
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

  toggleView() {
    this.currentView = this.currentView === 'card' ? 'list' : 'card';
    document.getElementById('btn-view').textContent = this.currentView === 'card' ? '☰ リスト' : '⊞ カード';
    const cached = Storage.getCached(this.currentTabId);
    if (cached) this.renderArticles(cached.data, this.currentTabId);
  },

  updateFetchCountInput() {
    document.getElementById('fetch-count').value = this.fetchCount;
  },

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

  showAddTabModal() {
    // ソース候補ピッカーを描画
    const picker = document.getElementById('source-picker');
    picker.innerHTML = '';
    Sources.getRssSources().forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.style.cssText = 'font-size:0.75rem;padding:4px 10px;';
      btn.textContent = s.name;
      btn.addEventListener('click', () => {
        document.getElementById('new-tab-rssurl').value = s.url;
        // 選択状態を視覚的に示す
        picker.querySelectorAll('button').forEach(b => b.style.borderColor = '');
        btn.style.borderColor = '#3b82f6';
        btn.style.color = '#3b82f6';
      });
      picker.appendChild(btn);
    });
    document.getElementById('modal-add-tab').classList.add('open');
  },

  hideAddTabModal() {
    document.getElementById('modal-add-tab').classList.remove('open');
    document.getElementById('new-tab-name').value = '';
    document.getElementById('new-tab-keyword').value = '';
    document.getElementById('new-tab-rssurl').value = '';
  },

  saveNewTab() {
    const name = document.getElementById('new-tab-name').value.trim();
    const keyword = document.getElementById('new-tab-keyword').value.trim();
    const rssUrl = document.getElementById('new-tab-rssurl').value.trim();
    if (!name) {
      alert('タブ名を入力してください。');
      return;
    }
    if (!rssUrl) {
      alert('RSS URLを入力してください。');
      return;
    }

    const icons = ['📌','🔍','💡','🌐','📡','🧩','⭐','🔥','🎯','💎'];
    const icon = icons[Math.floor(Math.random() * icons.length)];
    const colors = ['#6366f1','#8b5cf6','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const tab = {
      label: `${icon} ${name}`,
      icon,
      type: 'rss',
      rssUrls: [rssUrl],  // 必ず配列で保存
      keyword,
      color,
    };

    Sources.addCustomTab(tab);
    this.renderTabs();
    this.hideAddTabModal();
    const newId = Sources.getCustomTabs().slice(-1)[0].id;
    this.selectTab(newId);
  },

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
        <span class="source-url">${tab.keyword || (tab.rssUrls?.[0]) || ''}</span>
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

    const noneBtn = document.createElement('div');
    noneBtn.className = 'bg-thumb';
    noneBtn.textContent = 'なし';
    noneBtn.addEventListener('click', () => this.setBg('none', null));
    container.appendChild(noneBtn);

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
    document.getElementById('btn-fetch').addEventListener('click', () => {
      if (this.currentTabId && this.currentTabId !== '__bookmarks__') {
        this.fetchArticles(this.currentTabId);
      }
    });

    document.getElementById('btn-view').addEventListener('click', () => this.toggleView());
    document.getElementById('btn-settings').addEventListener('click', () => this.showSettingsModal());
    document.getElementById('btn-bg').addEventListener('click', () => this.showBgModal());

    document.getElementById('fetch-count').addEventListener('change', (e) => {
      const v = parseInt(e.target.value) || 20;
      this.fetchCount = Math.max(1, Math.min(200, v));
      e.target.value = this.fetchCount;
      Storage.saveSetting('fetchCount', this.fetchCount);
    });

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
    document.getElementById('btn-reset-defaults').addEventListener('click', () => {
      if (confirm('カスタムタブ・RSSソース設定・キャッシュを全て初期化します。よろしいですか？')) {
        // キャッシュも全消去
        Object.keys(localStorage).filter(k => k.startsWith('freyNewsHunter_')).forEach(k => localStorage.removeItem(k));
        Sources.resetToDefaults();
        this.renderTabs();
        this.hideSettingsModal();
        this.selectTab(this.config.fixedTabs[0].id);
        alert('初期化しました。');
      }
    });
    document.getElementById('btn-close-bg').addEventListener('click', () => this.hideBgModal());
    document.getElementById('btn-add-rss').addEventListener('click', () => this.addRssSource());

    document.getElementById('bg-zoom-slider').addEventListener('input', (e) => {
      const z = parseInt(e.target.value);
      document.getElementById('bg-zoom-value').textContent = z + '%';
      const setting = Storage.getBgSetting();
      setting.zoom = z;
      Storage.setBgSetting(setting);
      this.applyBackground();
    });

    document.getElementById('bg-upload-input').addEventListener('change', (e) => this.handleBgUpload(e));
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
