# Warikan-kun LIFF Frontend

## 目的
- LINE 版の最初の実装として、`LIFF` の入出力確認とフォーム導線をこのリポジトリ内で進める。
- 今回は `proposal.html` と `apply.html` を用意し、n8n API workflow に接続する前提の静的フロントを作る。
- UI はビルド不要の **React 18 UMD** で構成し、Cloudflare Pages にそのまま載せる。

## ファイル
- `index.html`: ランチャー兼メモ
- `proposal.html`: 主催者提案フォーム
- `apply.html`: 応募フォーム
- `assets/config.js`: LIFF ID と API Base URL の設定
- `assets/api.js`: n8n API クライアント
- `assets/liff-app.js`: LIFF 初期化と API 呼び出し用ランタイム
- `assets/react-app.js`: React UI 本体
- `assets/app.css`: 共通スタイル
- `../n8n-mvp/`: n8n / Google Sheets / 楽天検索の実装資材

## 最低限の設定
`assets/config.js` を編集して次を設定する。

```js
window.WARIKAN_LIFF_CONFIG = {
  apiBaseUrl: "https://<your-n8n-or-api-host>",
  publicBaseUrl: "https://<your-pages-domain>/line-liff",
  proposalLiffId: "<proposal-liff-id>",
  applyLiffId: "<apply-liff-id>",
  allowExternalPreview: true,
  debug: true,
  storageKey: "warikan-kun:liff:config",
  rakutenSearchEnabled: true
};
```

## LINE Developers Console 側
- Proposal 用 LIFF URL: `https://<your-pages-domain>/line-liff/proposal.html`
- Apply 用 LIFF URL: `https://<your-pages-domain>/line-liff/apply.html`

## API 前提
以下の n8n workflow API が存在する前提。

- `POST /api/liff/profile/bootstrap`
- `POST /api/liff/proposal/create`
- `GET /api/liff/products/search?keyword=...`
- `POST /api/liff/application/upsert`
- `GET /api/liff/proposal/:managementId`

## 注意
- クライアントは `lineUserId` を送らず、`idToken` のみ送る。
- `idToken` の検証はサーバ側で行い、`sub` を正の `lineUserId` として扱う。
- `apiBaseUrl` が未設定のときはプレビュー動作に落ちる。
- `proposal.html` / `apply.html` は CDN の React / ReactDOM / LIFF SDK を直接読むため、実際の LIFF 確認時はオンライン環境が必要。
- MVP の n8n 実装方針、Sheets ヘッダ、allowlist 例は `../n8n-mvp/` を参照する。
