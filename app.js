// app.js

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
    document.getElementById('fetch-count').value = this.fetchCount;
    this.selectTab(Sources.getFixedTabs()[0].id);
  },

  // ===== タブ描画 =====
  renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    tabBar.innerHTML = '';
    Sources.getAllTabs().forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span>${tab.icon || '📰'}</span><span class="tab-label">${tab.label}</span>`;
      btn.style.setProperty('--tab-color', tab.color || '#3b82f6');
      btn.addEventListener('click', () => this.selectTab(tab.id));
      tabBar.appendChild(btn);
    });

    // ブックマーク
    const bmBtn = document.createElement('button');
    bmBtn.className = 'tab-btn';
    bmBtn.dataset.tabId = '__bookmarks__';
    bmBtn.innerHTML = `<span>🔖</span><span class="tab-label">ブックマーク</span>`;
    bmBtn.style.setProperty('--tab-color', '#f59e0b');
    bmBtn.addEventListener('click', () => this.selectTab('__bookmarks__'));
    tabBar.appendChild(bmBtn);

    // タブ追加
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-btn tab-add';
    addBtn.innerHTML = `<span>＋</span><span class="tab-label">タブ追加</span>`;
    addBtn.addEventListener('click', () => this.showAddTabModal());
    tabBar.appendChild(addBtn);
  },

  selectTab(tabId) {
    this.currentTabId = tabId;
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tabId === tabId));
    if (tabId === '__bookmarks__') { this.renderBookmarks(); return; }
    const cached = Storage.getCached(tabId);
    if (cached) {
      this.renderArticles(cached.data, tabId);
      this.setStatus(`前回取得: ${new Date(cached.timestamp).toLocaleString('ja-JP')}　${cached.data.length}件`);
    } else {
      document.getElementById('articles-container').innerHTML =
        '<div class="no-articles">「今すぐ取得」を押してください</div>';
      this.setStatus('未取得');
    }
  },

  // ===== RSS取得 =====
  async fetchArticles(tabId) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFetchBtnLoading(true);
    this.showSkeleton();
    this.setStatus('取得中...');

    const tab = Sources.getAllTabs().find(t => t.id === tabId);
    if (!tab) { this.isLoading = false; this.setFetchBtnLoading(false); return; }

    const urls = Sources.getTabRssUrls(tab);
    if (urls.length === 0) {
      this.showError('このタブにRSS URLが設定されていません。⚙️設定からURLを追加してください。');
      this.isLoading = false; this.setFetchBtnLoading(false); return;
    }

    this.setStatus(`取得中... (${urls.map(u => { try { return new URL(u).hostname; } catch(e) { return u; }}).join(', ')})`);

    let allItems = [];
    const results = await Promise.allSettled(urls.map(u => this.fetchSingleRss(u, this.fetchCount)));
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value?.length > 0)
        allItems = allItems.concat(r.value);
    });

    // キーワードフィルタ
    // カスタムタブ：tab.keyword、固定タブ：tab.filterKeyword
    const keyword = tab.keyword || tab.filterKeyword || '';
    if (keyword) {
      const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = allItems.filter(item => {
        const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
        return kws.some(k => text.includes(k));
      });
      // フィルタ後に件数が極端に少ない場合（5件未満）はフィルタなしで全件使う
      if (filtered.length >= 5) allItems = filtered;
    }

    // 日付降順ソート
    allItems.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

    // 重複除去
    const seen = new Set();
    allItems = allItems.filter(item => {
      const key = (item.title || '').trim().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    const sliced = allItems.slice(0, this.fetchCount);
    if (sliced.length > 0) {
      Storage.setCache(tabId, sliced);
      this.renderArticles(sliced, tabId);
      const hosts = urls.map(u => { try { return new URL(u).hostname; } catch(e) { return u; }}).join(', ');
      this.setStatus(`取得: ${new Date().toLocaleString('ja-JP')}　${sliced.length}件　[${hosts}]`);
    } else {
      this.showError(`記事を取得できませんでした。URL: ${urls.join(' / ')}`);
    }

    this.isLoading = false;
    this.setFetchBtnLoading(false);
  },

  async fetchSingleRss(rssUrl, count) {
    count = count || 50;
    const proxies = [
      async (url) => {
        const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&count=${count}`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (d.status === 'ok' && d.items?.length > 0) {
          return d.items.map(item => ({
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
        const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        return d.contents ? this.parseRssXml(d.contents) : null;
      },
      async (url) => {
        const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
        const text = await r.text();
        return text ? this.parseRssXml(text) : null;
      },
    ];
    for (const proxy of proxies) {
      try {
        const items = await proxy(rssUrl);
        if (items?.length > 0) return items;
      } catch(e) {}
    }
    return [];
  },

  parseRssXml(xmlText) {
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const items = [];
      const rssItems = doc.querySelectorAll('item');
      if (rssItems.length > 0) {
        rssItems.forEach(el => {
          const get = tag => el.querySelector(tag)?.textContent?.trim() || '';
          const link = get('link') || el.querySelector('guid')?.textContent?.trim() || '';
          let img = '';
          const enc = el.querySelector('enclosure');
          if (enc?.getAttribute('type')?.startsWith('image')) img = enc.getAttribute('url') || '';
          if (!img) { const m = el.querySelector('[url]'); if (m) img = m.getAttribute('url') || ''; }
          if (!img) { const desc = get('description'); const mx = desc.match(/<img[^>]+src=["']([^"']+)["']/i); if (mx) img = mx[1]; }
          items.push({ title: get('title'), link, pubDate: get('pubDate'), author: get('author') || get('creator') || '', thumbnail: img, description: get('description') || '', source: { title: '' } });
        });
        return items;
      }
      doc.querySelectorAll('entry').forEach(el => {
        const get = tag => el.querySelector(tag)?.textContent?.trim() || '';
        const lnk = (el.querySelector('link[rel="alternate"]') || el.querySelector('link'))?.getAttribute('href') || '';
        items.push({ title: get('title'), link: lnk, pubDate: get('updated') || get('published') || '', author: el.querySelector('author name')?.textContent?.trim() || '', thumbnail: '', description: get('summary') || get('content') || '', source: { title: '' } });
      });
      return items;
    } catch(e) { return []; }
  },

  // ===== 記事描画 =====
  renderArticles(items, tabId) {
    const container = document.getElementById('articles-container');
    container.innerHTML = '';
    const tab = Sources.getAllTabs().find(t => t.id === tabId);
    const tabColor = tab?.color || '#3b82f6';
    if (!items?.length) { container.innerHTML = '<div class="no-articles">記事が見つかりませんでした。</div>'; return; }

    items.forEach((item, idx) => {
      const articleId = btoa(encodeURIComponent(item.link || item.title || idx)).slice(0, 32);
      const isRead = Storage.isRead(articleId);
      const isBookmarked = Storage.isBookmarked(articleId);
      let imgUrl = item.thumbnail || '';
      if (!imgUrl && item.description) {
        const m = item.description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) imgUrl = m[1];
      }
      const pubDate = item.pubDate ? new Date(item.pubDate).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const source = item.source?.title || item.author || '';
      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''} ${isRead ? 'is-read' : ''}`;
      card.style.setProperty('--card-color', tabColor);
      card.style.animationDelay = `${idx * 0.04}s`;
      const safeArticle = JSON.stringify({ id: articleId, title: item.title, link: item.link, pubDate: item.pubDate, source }).replace(/'/g, "&#39;");
      card.innerHTML = `
        <div class="card-thumb">
          ${imgUrl ? `<img src="${imgUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="thumb-placeholder" style="display:none;background:linear-gradient(135deg,${tabColor}44,${tabColor}22)"><span>${tab?.icon || '📰'}</span></div>`
          : `<div class="thumb-placeholder" style="background:linear-gradient(135deg,${tabColor}44,${tabColor}22)"><span>${tab?.icon || '📰'}</span></div>`}
          ${!isRead ? '<span class="badge-new">NEW</span>' : ''}
        </div>
        <div class="card-body">
          <div class="card-meta"><span class="card-source">${source}</span><span class="card-date">${pubDate}</span></div>
          <h3 class="card-title">${item.title || '(タイトルなし)'}</h3>
          <div class="card-actions">
            <button class="btn-open" data-url="${item.link}">🔗 開く</button>
            <button class="btn-bookmark ${isBookmarked ? 'bookmarked' : ''}" data-id="${articleId}" data-article='${safeArticle}'>🔖</button>
          </div>
        </div>`;
      card.querySelector('.btn-open').addEventListener('click', e => {
        e.stopPropagation();
        Storage.markRead(articleId);
        card.classList.add('is-read');
        card.querySelector('.badge-new')?.remove();
        window.open(item.link, '_blank');
      });
      card.querySelector('.btn-bookmark').addEventListener('click', e => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const art = JSON.parse(btn.dataset.article.replace(/&#39;/g, "'"));
        if (Storage.isBookmarked(articleId)) { Storage.removeBookmark(articleId); btn.classList.remove('bookmarked'); }
        else { Storage.addBookmark(art); btn.classList.add('bookmarked'); }
      });
      container.appendChild(card);
    });
  },

  renderBookmarks() {
    const container = document.getElementById('articles-container');
    container.innerHTML = '';
    const bookmarks = Storage.getBookmarks();
    this.setStatus(`ブックマーク: ${bookmarks.length}件`);
    if (!bookmarks.length) { container.innerHTML = '<div class="no-articles">ブックマークはまだありません。</div>'; return; }
    bookmarks.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''}`;
      card.style.setProperty('--card-color', '#f59e0b');
      card.style.animationDelay = `${idx * 0.04}s`;
      card.innerHTML = `
        <div class="card-thumb"><div class="thumb-placeholder" style="background:linear-gradient(135deg,#f59e0b44,#f59e0b22)"><span>🔖</span></div></div>
        <div class="card-body">
          <div class="card-meta"><span class="card-source">${item.source || ''}</span><span class="card-date">${item.pubDate ? new Date(item.pubDate).toLocaleString('ja-JP',{month:'numeric',day:'numeric'}) : ''}</span></div>
          <h3 class="card-title">${item.title || ''}</h3>
          <div class="card-actions">
            <button class="btn-open">🔗 開く</button>
            <button class="btn-remove-bm">🗑️ 削除</button>
          </div>
        </div>`;
      card.querySelector('.btn-open').addEventListener('click', () => window.open(item.link, '_blank'));
      card.querySelector('.btn-remove-bm').addEventListener('click', () => { Storage.removeBookmark(item.id); card.remove(); });
      container.appendChild(card);
    });
  },

  showSkeleton() {
    document.getElementById('articles-container').innerHTML = Array.from({length:6},()=>`
      <div class="article-card skeleton">
        <div class="card-thumb"><div class="skel-img"></div></div>
        <div class="card-body">
          <div class="skel-line short"></div><div class="skel-line"></div><div class="skel-line mid"></div>
        </div>
      </div>`).join('');
  },

  showError(msg) { document.getElementById('articles-container').innerHTML = `<div class="no-articles error">${msg}</div>`; },
  setStatus(msg) { document.getElementById('status-bar').textContent = msg; },
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

  // ===== 設定モーダル =====
  showSettingsModal() {
    this.renderTabEditList();
    this.renderRssSourcesList();
    document.getElementById('modal-settings').classList.add('open');
  },
  hideSettingsModal() { document.getElementById('modal-settings').classList.remove('open'); },

  // タブ編集リスト（固定タブ＋カスタムタブ、それぞれRSS URLを直接編集保存できる）
  renderTabEditList() {
    const list = document.getElementById('tab-edit-list');
    list.innerHTML = '';
    Sources.getAllTabs().forEach(tab => {
      const urls = Sources.getTabRssUrls(tab);
      const isCustom = tab.id.startsWith('custom_');
      const div = document.createElement('div');
      div.className = 'tab-edit-row';
      div.innerHTML = `
        <div class="tab-edit-header">
          <span class="tab-edit-label">${tab.icon || ''} ${tab.label}</span>
          ${isCustom ? `<button class="btn-del-source" data-id="${tab.id}">🗑️ 削除</button>` : ''}
        </div>
        <textarea class="tab-edit-urls" data-id="${tab.id}" rows="3" placeholder="RSSのURLを1行1つで入力">${urls.join('\n')}</textarea>
        ${isCustom ? `<input class="tab-edit-keyword" data-id="${tab.id}" type="text" placeholder="キーワード（任意）" value="${tab.keyword || ''}">` : ''}
        <button class="btn-save-tab-urls btn-primary" data-id="${tab.id}" style="margin-top:6px;font-size:0.78rem;padding:5px 14px;">💾 このタブのURLを保存</button>
      `;
      div.querySelector('.btn-save-tab-urls').addEventListener('click', () => {
        const textarea = div.querySelector('.textarea, textarea.tab-edit-urls') || div.querySelector('textarea');
        const rawUrls = textarea.value.split('\n').map(u => u.trim()).filter(u => u);
        if (rawUrls.length === 0) { alert('URLを1つ以上入力してください。'); return; }
        if (isCustom) {
          const kwInput = div.querySelector('.tab-edit-keyword');
          const kw = kwInput ? kwInput.value.trim() : '';
          Sources.updateCustomTabUrls(tab.id, rawUrls, kw);
        } else {
          Sources.updateFixedTabUrls(tab.id, rawUrls);
        }
        // キャッシュを削除して次回取得時に反映
        Storage.remove('cache_' + tab.id);
        alert(`「${tab.label}」のURLを保存しました。`);
      });
      if (isCustom) {
        div.querySelector('.btn-del-source').addEventListener('click', () => {
          if (confirm(`「${tab.label}」を削除しますか？`)) {
            Sources.removeCustomTab(tab.id);
            this.renderTabs();
            this.renderTabEditList();
          }
        });
      }
      list.appendChild(div);
    });
  },

  renderRssSourcesList() {
    const list = document.getElementById('rss-sources-list');
    list.innerHTML = '';
    Sources.getRssSources().forEach(s => {
      const row = document.createElement('div');
      row.className = 'source-row';
      row.innerHTML = `
        <span class="source-name">${s.name}</span>
        <span class="source-url">${s.url}</span>
        <button class="btn-copy-url" data-url="${s.url}" title="URLをコピー">📋</button>
        <button class="btn-del-source" data-id="${s.id}">🗑️</button>
      `;
      row.querySelector('.btn-copy-url').addEventListener('click', e => {
        navigator.clipboard.writeText(e.currentTarget.dataset.url).then(() => alert('URLをコピーしました'));
      });
      row.querySelector('.btn-del-source').addEventListener('click', () => {
        Sources.removeRssSource(s.id);
        this.renderRssSourcesList();
      });
      list.appendChild(row);
    });
  },

  // ===== タブ追加モーダル =====
  showAddTabModal() {
    // RSSソース候補ボタンを描画
    const picker = document.getElementById('source-picker');
    picker.innerHTML = '';
    Sources.getRssSources().forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.style.cssText = 'font-size:0.75rem;padding:4px 10px;';
      btn.textContent = s.name;
      btn.addEventListener('click', () => {
        const ta = document.getElementById('new-tab-rssurls');
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + s.url;
        picker.querySelectorAll('button').forEach(b => b.style.color = '');
        btn.style.color = '#3b82f6';
      });
      picker.appendChild(btn);
    });
    document.getElementById('new-tab-name').value = '';
    document.getElementById('new-tab-keyword').value = '';
    document.getElementById('new-tab-rssurls').value = '';
    document.getElementById('modal-add-tab').classList.add('open');
  },
  hideAddTabModal() { document.getElementById('modal-add-tab').classList.remove('open'); },

  saveNewTab() {
    const name = document.getElementById('new-tab-name').value.trim();
    const keyword = document.getElementById('new-tab-keyword').value.trim();
    const rawUrls = document.getElementById('new-tab-rssurls').value.split('\n').map(u => u.trim()).filter(u => u);
    if (!name) { alert('タブ名を入力してください。'); return; }
    if (!rawUrls.length) { alert('RSS URLを1つ以上入力してください。'); return; }
    const icons = ['📌','🔍','💡','🌐','📡','🧩','⭐','🔥','🎯','💎'];
    const icon = icons[Math.floor(Math.random() * icons.length)];
    const colors = ['#6366f1','#8b5cf6','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const newId = Sources.addCustomTab(name, icon, color, rawUrls, keyword);
    this.renderTabs();
    this.hideAddTabModal();
    this.selectTab(newId);
  },

  // ===== 背景 =====
  applyBackground() {
    const s = Storage.getBgSetting();
    const bgLayer = document.getElementById('bg-layer');
    const bgVideo = document.getElementById('bg-video');
    bgLayer.style.backgroundImage = '';
    bgVideo.style.display = 'none'; bgVideo.src = '';
    if (s.type === 'image') {
      bgLayer.style.backgroundImage = `url('${s.value}')`;
      bgLayer.style.backgroundSize = `${s.zoom||100}%`;
      bgLayer.style.backgroundPosition = 'center top';
      bgLayer.style.backgroundRepeat = 'no-repeat';
    } else if (s.type === 'video') {
      bgVideo.src = s.value; bgVideo.style.display = 'block';
      bgVideo.style.transform = `scale(${(s.zoom||100)/100})`;
    } else if (s.type === 'upload') {
      const data = Storage.getUploadedBg();
      if (data) { bgLayer.style.backgroundImage = `url('${data}')`; bgLayer.style.backgroundSize = `${s.zoom||100}%`; bgLayer.style.backgroundPosition = 'center top'; bgLayer.style.backgroundRepeat = 'no-repeat'; }
    }
  },
  setBg(type, value) {
    const z = Storage.getBgSetting().zoom || 100;
    Storage.setBgSetting({ type, value, zoom: z });
    this.applyBackground();
  },
  showBgModal() {
    document.getElementById('modal-bg').classList.add('open');
    const container = document.getElementById('bg-thumbs');
    container.innerHTML = '';
    const noneBtn = document.createElement('div');
    noneBtn.className = 'bg-thumb'; noneBtn.textContent = 'なし';
    noneBtn.addEventListener('click', () => this.setBg('none', null));
    container.appendChild(noneBtn);
    this.config.backgrounds.forEach(bg => {
      const div = document.createElement('div');
      div.className = 'bg-thumb';
      if (bg.type === 'video') {
        div.innerHTML = `<video src="${bg.file}" muted loop autoplay style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></video><span class="bg-label">${bg.label}</span>`;
      } else {
        div.style.cssText = `background-image:url('${bg.file}');background-size:cover;background-position:center;`;
        div.innerHTML = `<span class="bg-label">${bg.label}</span>`;
      }
      div.addEventListener('click', () => this.setBg(bg.type, bg.file));
      container.appendChild(div);
    });
    const s = Storage.getBgSetting();
    document.getElementById('bg-zoom-slider').value = s.zoom || 100;
    document.getElementById('bg-zoom-value').textContent = (s.zoom||100)+'%';
  },
  hideBgModal() { document.getElementById('modal-bg').classList.remove('open'); },

  // ===== イベント =====
  bindEvents() {
    document.getElementById('btn-fetch').addEventListener('click', () => {
      if (this.currentTabId && this.currentTabId !== '__bookmarks__') this.fetchArticles(this.currentTabId);
    });
    document.getElementById('btn-view').addEventListener('click', () => this.toggleView());
    document.getElementById('btn-settings').addEventListener('click', () => this.showSettingsModal());
    document.getElementById('btn-bg').addEventListener('click', () => this.showBgModal());
    document.getElementById('fetch-count').addEventListener('change', e => {
      const v = Math.max(1, Math.min(200, parseInt(e.target.value)||20));
      this.fetchCount = v; e.target.value = v;
      Storage.saveSetting('fetchCount', v);
    });
    // モーダル背景クリックで閉じる
    ['modal-add-tab','modal-settings','modal-bg'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
    });
    document.getElementById('btn-save-tab').addEventListener('click', () => this.saveNewTab());
    document.getElementById('btn-cancel-tab').addEventListener('click', () => this.hideAddTabModal());
    document.getElementById('btn-close-settings').addEventListener('click', () => this.hideSettingsModal());
    document.getElementById('btn-close-bg').addEventListener('click', () => this.hideBgModal());
    document.getElementById('btn-add-rss').addEventListener('click', () => {
      const name = document.getElementById('new-rss-name').value.trim();
      const url = document.getElementById('new-rss-url').value.trim();
      if (!name || !url) { alert('名前とURLを入力してください。'); return; }
      Sources.addRssSource(name, url);
      document.getElementById('new-rss-name').value = '';
      document.getElementById('new-rss-url').value = '';
      this.renderRssSourcesList();
    });
    document.getElementById('btn-reset-defaults').addEventListener('click', () => {
      if (confirm('全設定（タブのURL・カスタムタブ・キャッシュ）を初期値に戻します。よろしいですか？')) {
        // キャッシュ含む全LocalStorageを消去
        const keys = Object.keys(localStorage).filter(k => k.startsWith('freyNewsHunter_'));
        keys.forEach(k => localStorage.removeItem(k));
        Sources.resetAll();
        this.renderTabs();
        this.hideSettingsModal();
        this.selectTab(Sources.getFixedTabs()[0].id);
      }
    });
    document.getElementById('bg-zoom-slider').addEventListener('input', e => {
      const z = parseInt(e.target.value);
      document.getElementById('bg-zoom-value').textContent = z+'%';
      const s = Storage.getBgSetting(); s.zoom = z;
      Storage.setBgSetting(s); this.applyBackground();
    });
    document.getElementById('bg-upload-input').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => { Storage.setUploadedBg(ev.target.result); this.setBg('upload', null); };
      reader.readAsDataURL(file);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
