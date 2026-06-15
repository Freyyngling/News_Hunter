# Frey's News Hunter

フレイ専用カスタムニュースアグリゲーター

## ファイル構成

```
frey-news-hunter/
├── index.html       # メインページ
├── style.css        # スタイル
├── app.js           # メインロジック
├── sources.js       # RSSソース・タブ管理
├── storage.js       # LocalStorage管理
├── config.json      # 初期設定・RSSソース定義
├── manifest.json    # PWA設定
├── bg/              # 背景画像・動画フォルダ
│   ├── bg1.jpeg
│   ├── bg2.jpeg
│   └── bg3.mp4
└── icons/           # PWAアイコンフォルダ（任意）
    ├── icon-192.png
    └── icon-512.png
```

## セットアップ

1. このフォルダごとGitHubリポジトリにアップロード
2. `bg/` フォルダに背景画像・動画を追加
   - `bg1.jpeg` `bg2.jpeg` `bg3.mp4` という名前で置く
   - 名前を変える場合は `config.json` の `backgrounds` 配列を編集
3. GitHub Pages を有効化

## カスタマイズ

### RSSソースの追加（config.json）
`defaultRssSources` 配列に追加：
```json
{
  "id": "my_site",
  "name": "サイト名",
  "url": "https://example.com/rss",
  "enabled": true
}
```

### カスタムタブの初期値変更（config.json）
`defaultCustomTabs` 配列を編集。
`type: "keyword"` でGoogleニュースキーワード検索。
`type: "rss"` で直接RSSのURL指定。

### 取得件数の上限変更（config.json）
`defaultFetchCount` の数値を変更。

## 注意事項

- rss2json.com の無料APIを使用。1日500リクエストまで。
- 背景動画のアップロード機能はなし（GitHubに直接置く）
- 背景画像のアップロードはLocalStorageに保存（5MB以内推奨）
- PWAとして使うにはiconsフォルダにアイコン画像が必要
