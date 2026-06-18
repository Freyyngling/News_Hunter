// app.js
const App = {
  config: null,
  currentGroupId: null,
  currentCatId: null,
  currentView: 'card',
  fetchCount: 20,
  isLoading: false,

  async init() {
    const res = await fetch('config.json');
    this.config = await res.json();
    await Sources.init(this.config);
    this.fetchCount = Storage.getSettings().fetchCount || this.config.defaultFetchCount;
    document.getElementById('fetch-count').value = this.fetchCount;

    this.renderGroupTabs();
    this.bindEvents();
    this.applyBackground();

    // 最初のグループ・カテゴリを選択
    const firstGroup = Sources.getGroups()[0];
    if (firstGroup) this.selectGroup(firstGroup.id, false);
  },

  // ===== グループタブ描画 =====
  renderGroupTabs() {
    const bar = document.getElementById('group-tab-bar');
    bar.innerHTML = '';

    Sources.getGroups().forEach(g => {
      const btn = document.createElement('button');
      btn.className = 'group-tab-btn';
      btn.dataset.groupId = g.id;
      btn.textContent = g.label;
      btn.style.setProperty('--grp-color', g.color || '#3b82f6');
      btn.addEventListener('click', () => this.selectGroup(g.id, true));
      bar.appendChild(btn);
    });

    // ブックマーク
    const bmBtn = document.createElement('button');
    bmBtn.className = 'group-tab-btn bm-btn';
    bmBtn.dataset.groupId = '__bookmarks__';
    bmBtn.textContent = '🔖 ブックマーク';
    bmBtn.style.setProperty('--grp-color', '#f59e0b');
    bmBtn.addEventListener('click', () => this.selectGroup('__bookmarks__', true));
    bar.appendChild(bmBtn);

    // グループ追加
    const addBtn = document.createElement('button');
    addBtn.className = 'group-tab-btn add-btn';
    addBtn.textContent = '＋ ソース追加';
    addBtn.addEventListener('click', () => this.showAddGroupModal());
    bar.appendChild(addBtn);
  },

  // ===== カテゴリサブタブ描画 =====
  renderCategoryTabs(groupId) {
    const wrap = document.getElementById('cat-tab-bar-wrap');
    const bar = document.getElementById('cat-tab-bar');
    bar.innerHTML = '';

    if (groupId === '__bookmarks__') {
      wrap.style.display = 'none';
      return;
    }

    const group = Sources.getGroup(groupId);
    if (!group) { wrap.style.display = 'none'; return; }

    wrap.style.display = 'block';

    group.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'cat-tab-btn';
      btn.dataset.catId = cat.id;
      btn.textContent = cat.label;
      btn.style.setProperty('--grp-color', group.color || '#3b82f6');
      btn.addEventListener('click', () => this.selectCategory(groupId, cat.id));
      bar.appendChild(btn);
    });

    // カテゴリ追加ボタン
    const addBtn = document.createElement('button');
    addBtn.className = 'cat-tab-btn cat-add-btn';
    addBtn.textContent = '＋';
    addBtn.title = 'カテゴリを追加';
    addBtn.addEventListener('click', () => this.showAddCategoryModal(groupId));
    bar.appendChild(addBtn);
  },

  selectGroup(groupId, autoSelectFirstCat) {
    this.currentGroupId = groupId;

    document.querySelectorAll('.group-tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.groupId === groupId));

    if (groupId === '__bookmarks__') {
      this.renderCategoryTabs('__bookmarks__');
      this.renderBookmarks();
      return;
    }

    this.renderCategoryTabs(groupId);

    if (autoSelectFirstCat) {
      const group = Sources.getGroup(groupId);
      if (group?.categories.length > 0) {
        this.selectCategory(groupId, group.categories[0].id);
      } else {
        document.getElementById('articles-container').innerHTML =
          '<div class="no-articles">カテゴリがありません。「＋」から追加してください。</div>';
        this.setStatus('');
      }
    }
  },

  selectCategory(groupId, catId) {
    this.currentGroupId = groupId;
    this.currentCatId = catId;

    document.querySelectorAll('.cat-tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.catId === catId));

    const cached = Storage.getCached(catId);
    if (cached) {
      this.renderArticles(cached.data, groupId, catId);
      this.setStatus(`前回取得: ${new Date(cached.timestamp).toLocaleString('ja-JP')}　${cached.data.length}件`);
    } else {
      document.getElementById('articles-container').innerHTML =
        '<div class="no-articles">「🔄 今すぐ取得」を押してください</div>';
      this.setStatus('未取得');
    }
  },

  // ===== RSS取得 =====
  async fetchArticles() {
    if (this.isLoading) return;
    if (!this.currentGroupId || this.currentGroupId === '__bookmarks__') return;
    if (!this.currentCatId) return;

    const group = Sources.getGroup(this.currentGroupId);
    const cat = Sources.getCategory(this.currentGroupId, this.currentCatId);
    if (!group || !cat) return;

    const rssUrl = Sources.getCatRssUrl(cat);
    if (!rssUrl) {
      this.showError('このカテゴリにRSS URLが設定されていません。');
      return;
    }

    this.isLoading = true;
    this.setFetchBtnLoading(true);
    this.showSkeleton();

    let hostname = '';
    try { hostname = new URL(rssUrl).hostname; } catch(e) { hostname = rssUrl; }
    this.setStatus(`取得中... [${hostname}]`);

    const items = await this.fetchRss(rssUrl, this.fetchCount);

    // キーワードフィルタ（カテゴリにkeywordが設定されている場合）
    let filtered = items;
    if (cat.keyword && items.length > 0) {
      const kws = cat.keyword.toLowerCase().split(/\s+/).filter(Boolean);
      const f = items.filter(item => {
        const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
        return kws.some(k => text.includes(k));
      });
      if (f.length >= 3) filtered = f;
    }

    const sliced = filtered.slice(0, this.fetchCount);

    if (sliced.length > 0) {
      Storage.setCache(this.currentCatId, sliced);
      this.renderArticles(sliced, this.currentGroupId, this.currentCatId);
      this.setStatus(`取得: ${new Date().toLocaleString('ja-JP')}　${sliced.length}件　[${hostname}]`);
    } else {
      this.showError(`記事を取得できませんでした。[${hostname}]`);
    }

    this.isLoading = false;
    this.setFetchBtnLoading(false);
  },

  // RSSを複数プロキシでフォールバック取得
  async fetchRss(rssUrl, count) {
    const proxies = [
      async (url) => {
        const r = await fetch(
          `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&count=${count}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const d = await r.json();
        if (d.status === 'ok' && d.items?.length > 0) {
          return d.items.map(item => ({
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate || '',
            author: item.author || '',
            thumbnail: item.thumbnail || item.enclosure?.link || '',
            description: item.description || item.content || '',
          }));
        }
        return null;
      },
      async (url) => {
        const r = await fetch(
          `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const d = await r.json();
        return d.contents ? this.parseXml(d.contents) : null;
      },
      async (url) => {
        const r = await fetch(
          `https://corsproxy.io/?${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const t = await r.text();
        return t ? this.parseXml(t) : null;
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

  parseXml(xmlText) {
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const items = [];
      const nodes = doc.querySelectorAll('item');
      if (nodes.length > 0) {
        nodes.forEach(el => {
          const get = t => el.querySelector(t)?.textContent?.trim() || '';
          const link = get('link') || el.querySelector('guid')?.textContent?.trim() || '';
          let img = '';
          const enc = el.querySelector('enclosure');
          if (enc?.getAttribute('type')?.startsWith('image')) img = enc.getAttribute('url') || '';
          if (!img) { const m = el.querySelector('[url]'); if (m) img = m.getAttribute('url') || ''; }
          if (!img) { const mx = get('description').match(/<img[^>]+src=["']([^"']+)["']/i); if (mx) img = mx[1]; }
          items.push({ title: get('title'), link, pubDate: get('pubDate'), author: get('author') || get('creator') || '', thumbnail: img, description: get('description') || '' });
        });
        return items;
      }
      doc.querySelectorAll('entry').forEach(el => {
        const get = t => el.querySelector(t)?.textContent?.trim() || '';
        const lnk = (el.querySelector('link[rel="alternate"]') || el.querySelector('link'))?.getAttribute('href') || '';
        items.push({ title: get('title'), link: lnk, pubDate: get('updated') || get('published') || '', author: el.querySelector('author name')?.textContent?.trim() || '', thumbnail: '', description: get('summary') || get('content') || '' });
      });
      return items;
    } catch(e) { return []; }
  },

  // ===== 記事描画 =====
  renderArticles(items, groupId, catId) {
    const container = document.getElementById('articles-container');
    container.innerHTML = '';
    const group = Sources.getGroup(groupId);
    const color = group?.color || '#3b82f6';

    if (!items?.length) {
      container.innerHTML = '<div class="no-articles">記事が見つかりませんでした。</div>';
      return;
    }

    items.forEach((item, idx) => {
      const articleId = btoa(encodeURIComponent(item.link || item.title || idx)).slice(0, 32);
      const isRead = Storage.isRead(articleId);
      const isBookmarked = Storage.isBookmarked(articleId);
      let imgUrl = item.thumbnail || '';
      if (!imgUrl && item.description) {
        const m = item.description.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) imgUrl = m[1];
      }
      const pubDate = item.pubDate
        ? new Date(item.pubDate).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';

      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''} ${isRead ? 'is-read' : ''}`;
      card.style.setProperty('--card-color', color);
      card.style.animationDelay = `${idx * 0.03}s`;
      card.style.cursor = 'pointer';

      card.innerHTML = `
        <div class="card-thumb">
          ${imgUrl
            ? `<img src="${imgUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
               <div class="thumb-placeholder" style="display:none;background:linear-gradient(135deg,${color}44,${color}22)"><span>${group?.label?.slice(0,2) || '📰'}</span></div>`
            : `<div class="thumb-placeholder" style="background:linear-gradient(135deg,${color}44,${color}22)"><span>${group?.label?.slice(0,2) || '📰'}</span></div>`
          }
          ${!isRead ? '<span class="badge-new">NEW</span>' : ''}
          <button class="btn-bookmark-overlay ${isBookmarked ? 'bookmarked' : ''}" data-id="${articleId}" title="ブックマーク">🔖</button>
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="card-source">${item.author || ''}</span>
            <span class="card-date">${pubDate}</span>
          </div>
          <h3 class="card-title">${item.title || '(タイトルなし)'}</h3>
        </div>
      `;

      // カード全体タッチで記事へ飛ぶ
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-bookmark-overlay')) return;
        if (!item.link) return;
        Storage.markRead(articleId);
        card.classList.add('is-read');
        card.querySelector('.badge-new')?.remove();
        window.open(item.link, '_blank');
      });

      // ブックマークボタン
      card.querySelector('.btn-bookmark-overlay').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const artData = { id: articleId, title: item.title, link: item.link, pubDate: item.pubDate, author: item.author || '' };
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
    if (!bookmarks.length) {
      container.innerHTML = '<div class="no-articles">ブックマークはまだありません。</div>';
      return;
    }
    bookmarks.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = `article-card ${this.currentView === 'list' ? 'list-view' : ''}`;
      card.style.setProperty('--card-color', '#f59e0b');
      card.style.animationDelay = `${idx * 0.03}s`;
      card.style.cursor = 'pointer';
      card.innerHTML = `
        <div class="card-thumb">
          <div class="thumb-placeholder" style="background:linear-gradient(135deg,#f59e0b44,#f59e0b22)"><span>🔖</span></div>
          <button class="btn-bookmark-overlay bookmarked" data-id="${item.id}" title="ブックマーク解除">🔖</button>
        </div>
        <div class="card-body">
          <div class="card-meta">
            <span class="card-source">${item.author || ''}</span>
            <span class="card-date">${item.pubDate ? new Date(item.pubDate).toLocaleString('ja-JP',{month:'numeric',day:'numeric'}) : ''}</span>
          </div>
          <h3 class="card-title">${item.title || ''}</h3>
        </div>`;
      card.addEventListener('click', e => {
        if (e.target.closest('.btn-bookmark-overlay')) return;
        if (item.link) window.open(item.link, '_blank');
      });
      card.querySelector('.btn-bookmark-overlay').addEventListener('click', e => {
        e.stopPropagation();
        Storage.removeBookmark(item.id);
        card.remove();
        this.setStatus(`ブックマーク: ${Storage.getBookmarks().length}件`);
      });
      container.appendChild(card);
    });
  },

  showSkeleton() {
    document.getElementById('articles-container').innerHTML = Array.from({length:8},()=>`
      <div class="article-card skeleton">
        <div class="card-thumb"><div class="skel-img"></div></div>
        <div class="card-body">
          <div class="skel-line short"></div>
          <div class="skel-line"></div>
          <div class="skel-line mid"></div>
        </div>
      </div>`).join('');
  },

  showError(msg) {
    document.getElementById('articles-container').innerHTML = `<div class="no-articles error">${msg}</div>`;
  },

  setStatus(msg) { document.getElementById('status-bar').textContent = msg; },

  setFetchBtnLoading(loading) {
    const btn = document.getElementById('btn-fetch');
    btn.disabled = loading;
    btn.textContent = loading ? '取得中...' : '🔄 今すぐ取得';
  },

  toggleView() {
    this.currentView = this.currentView === 'card' ? 'list' : 'card';
    document.getElementById('btn-view').textContent = this.currentView === 'card' ? '☰ リスト' : '⊞ カード';
    const cached = this.currentCatId ? Storage.getCached(this.currentCatId) : null;
    if (cached) this.renderArticles(cached.data, this.currentGroupId, this.currentCatId);
  },

  // ===== 設定モーダル =====
  showSettingsModal() {
    this.renderSettingsGroupList();
    document.getElementById('modal-settings').classList.add('open');
  },
  hideSettingsModal() { document.getElementById('modal-settings').classList.remove('open'); },

  renderSettingsGroupList() {
    const container = document.getElementById('settings-group-list');
    container.innerHTML = '';
    Sources.getGroups().forEach(group => {
      const section = document.createElement('div');
      section.className = 'settings-group-section';
      section.innerHTML = `
        <div class="settings-group-header">
          <span style="color:${group.color};font-weight:700;">${group.label}</span>
          <button class="btn-del-source" data-gid="${group.id}" title="このソースを削除">🗑️ ソース削除</button>
        </div>
        <div class="cat-edit-list" id="cats-${group.id}"></div>
        <div class="add-cat-row">
          <input type="text" placeholder="カテゴリ名" id="cat-name-${group.id}">
          <input type="url" placeholder="RSS URL" id="cat-url-${group.id}">
          <input type="text" placeholder="キーワード（任意）" id="cat-kw-${group.id}">
          <button class="btn-primary btn-add-cat" data-gid="${group.id}" style="font-size:0.78rem;padding:5px 12px;">追加</button>
        </div>`;

      // カテゴリ一覧
      const catList = section.querySelector(`#cats-${group.id}`);
      group.categories.forEach(cat => {
        const row = document.createElement('div');
        row.className = 'cat-edit-row';
        row.innerHTML = `
          <span class="cat-edit-label">${cat.label}</span>
          <input class="cat-edit-url" type="url" value="${cat.rssUrl || ''}" placeholder="RSS URL" data-gid="${group.id}" data-cid="${cat.id}">
          <input class="cat-edit-kw" type="text" value="${cat.keyword || ''}" placeholder="キーワード" data-gid="${group.id}" data-cid="${cat.id}">
          <button class="btn-save-cat btn-primary" data-gid="${group.id}" data-cid="${cat.id}" style="font-size:0.75rem;padding:4px 10px;">💾</button>
          <button class="btn-del-source btn-del-cat" data-gid="${group.id}" data-cid="${cat.id}">🗑️</button>`;
        catList.appendChild(row);
      });

      container.appendChild(section);
    });

    // イベント委譲
    container.querySelectorAll('.btn-del-source[data-gid]:not([data-cid])').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm(`「${btn.closest('.settings-group-section').querySelector('span').textContent}」を削除しますか？`)) {
          Sources.removeGroup(btn.dataset.gid);
          this.renderGroupTabs();
          this.renderSettingsGroupList();
        }
      });
    });
    container.querySelectorAll('.btn-save-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.cat-edit-row');
        const url = row.querySelector('.cat-edit-url').value.trim();
        const kw  = row.querySelector('.cat-edit-kw').value.trim();
        Sources.updateCategory(btn.dataset.gid, btn.dataset.cid, { rssUrl: url, keyword: kw });
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = '💾', 1500);
      });
    });
    container.querySelectorAll('.btn-del-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        Sources.removeCategory(btn.dataset.gid, btn.dataset.cid);
        this.renderCategoryTabs(this.currentGroupId);
        this.renderSettingsGroupList();
      });
    });
    container.querySelectorAll('.btn-add-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        const gid  = btn.dataset.gid;
        const name = document.getElementById(`cat-name-${gid}`).value.trim();
        const url  = document.getElementById(`cat-url-${gid}`).value.trim();
        const kw   = document.getElementById(`cat-kw-${gid}`).value.trim();
        if (!name || !url) { alert('カテゴリ名とRSS URLを入力してください。'); return; }
        Sources.addCategory(gid, name, url, kw);
        this.renderCategoryTabs(this.currentGroupId);
        this.renderSettingsGroupList();
      });
    });
  },

  // ===== ソースグループ追加モーダル =====
  showAddGroupModal() {
    document.getElementById('new-group-name').value = '';
    document.getElementById('modal-add-group').classList.add('open');
  },
  hideAddGroupModal() { document.getElementById('modal-add-group').classList.remove('open'); },

  saveNewGroup() {
    const name = document.getElementById('new-group-name').value.trim();
    if (!name) { alert('ソース名を入力してください。'); return; }
    const colors = ['#6366f1','#8b5cf6','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const id = Sources.addGroup(name, color);
    this.renderGroupTabs();
    this.hideAddGroupModal();
    this.selectGroup(id, false);
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
      if (data) {
        bgLayer.style.backgroundImage = `url('${data}')`;
        bgLayer.style.backgroundSize = `${s.zoom||100}%`;
        bgLayer.style.backgroundPosition = 'center top';
        bgLayer.style.backgroundRepeat = 'no-repeat';
      }
    }
  },
  setBg(type, value) {
    Storage.setBgSetting({ type, value, zoom: Storage.getBgSetting().zoom || 100 });
    this.applyBackground();
  },
  showBgModal() {
    const container = document.getElementById('bg-thumbs');
    container.innerHTML = '';
    const none = document.createElement('div');
    none.className = 'bg-thumb'; none.textContent = 'なし';
    none.addEventListener('click', () => this.setBg('none', null));
    container.appendChild(none);
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
    document.getElementById('bg-zoom-value').textContent = (s.zoom||100) + '%';
    document.getElementById('modal-bg').classList.add('open');
  },
  hideBgModal() { document.getElementById('modal-bg').classList.remove('open'); },

  // ===== イベント =====
  bindEvents() {
    document.getElementById('btn-fetch').addEventListener('click', () => this.fetchArticles());
    document.getElementById('btn-view').addEventListener('click', () => this.toggleView());
    document.getElementById('btn-settings').addEventListener('click', () => this.showSettingsModal());
    document.getElementById('btn-bg').addEventListener('click', () => this.showBgModal());

    document.getElementById('fetch-count').addEventListener('change', e => {
      const v = Math.max(1, Math.min(200, parseInt(e.target.value) || 20));
      this.fetchCount = v; e.target.value = v;
      Storage.saveSetting('fetchCount', v);
    });

    ['modal-add-group','modal-settings','modal-bg'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
      });
    });

    document.getElementById('btn-save-group').addEventListener('click', () => this.saveNewGroup());
    document.getElementById('btn-cancel-group').addEventListener('click', () => this.hideAddGroupModal());
    document.getElementById('btn-close-settings').addEventListener('click', () => this.hideSettingsModal());
    document.getElementById('btn-close-bg').addEventListener('click', () => this.hideBgModal());

    document.getElementById('btn-reset-defaults').addEventListener('click', () => {
      if (confirm('全設定とキャッシュを初期値に戻します。よろしいですか？')) {
        Object.keys(localStorage).filter(k => k.startsWith('freyNewsHunter_')).forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('freyNewsHunter_configVer');
        Sources.resetAll();
        this.renderGroupTabs();
        this.hideSettingsModal();
        this.selectGroup(Sources.getGroups()[0].id, true);
      }
    });

    document.getElementById('bg-zoom-slider').addEventListener('input', e => {
      const z = parseInt(e.target.value);
      document.getElementById('bg-zoom-value').textContent = z + '%';
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
