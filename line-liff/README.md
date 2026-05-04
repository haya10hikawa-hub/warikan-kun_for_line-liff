# Warikan-kun LIFF Frontend

## 目的
- LINE 版の最初の実装として、`LIFF` の入出力確認とフォーム導線をこのリポジトリ内で進める。
- 今回は `proposal.html` と `apply.html` を用意し、n8n API workflow と LINE Messaging API の募集カード導線に接続する前提の静的フロントを作る。
- UI はビルド不要の **React 18 UMD** で構成し、Cloudflare Pages にそのまま載せる。

## 導線の役割
- `proposal.html`: 主催者が 2 ステップで募集を開始し、bot のグループ投稿完了まで進める主導線。
- LINE グループ投稿: 参加者が最初に触る主導線。`欲しい` → `1個 / 2個 / 3個 / その他` で進む。
- `apply.html`: `その他` 数量と再編集だけを扱う画面。`その他` は `mode=other` 付きで開く。参加者の通常導線にはしない。
- 応募後: 支払い案内、証跡提出、注文催促、完了通知は 1:1 DM に切り替える。

## ファイル
- `index.html`: スマホ用ランチャー
- `proposal.html`: 主催者提案フォーム
- `apply.html`: その他数量・再編集用の応募画面
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
- Apply 用 LIFF URL: `https://<your-pages-domain>/line-liff/apply.html?managementId=...`

## API 前提
以下の n8n workflow API が存在する前提。

- `POST /api/liff/profile/bootstrap`
- `POST /api/liff/proposal/create`
- `POST /api/liff/proposal/:managementId/post`
- `POST /api/line/webhook`
- `GET /api/liff/products/search?keyword=...`
- `POST /api/liff/products/infer-count`
- `POST /api/liff/application/upsert`
- `GET /api/liff/proposal/:managementId`

## 注意
- クライアントは `lineUserId` を送らず、`idToken` のみ送る。
- `idToken` の検証はサーバ側で行い、`sub` を正の `lineUserId` として扱う。
- `profile/bootstrap`, `proposal/create`, `application/upsert` などの write request には `idempotencyKey` を付ける。
- `apiBaseUrl` が未設定のときはプレビュー動作に落ちる。
- `profile/bootstrap` の `profileCompleteness.hasDefaultPayPayId=false` または PayPay ID 空のときは、`proposal.html` が PayPay ID を標準表示する。
- `proposal.html` は LIFF context から `groupId` または `roomId` が取れる場合だけ作成できる。投稿成功時だけ完了画面を出し、5秒後に `liff.closeWindow()` でLINEへ戻る。
- グループ外で `proposal.html` を開いた場合は、フォームではなくグループ起動案内を出す。
- 投稿失敗時は手動コピーを主導線にせず、同じ `managementId` に対する再試行画面を出す。
- `apply.html` は主催者または bot が配布した `applyUrl` から開く前提で、案件IDの手入力 fallback は持たない。
- `1個 / 2個 / 3個` の通常応募は Messaging API webhook 側で保存し、`その他` と再編集は `apply.html` から同じ `application/upsert` へ寄せる。
- 商品候補を選んだ後は、LIFF内正規表現で即時に商品個数を推定し、未確定の場合だけ `products/infer-count` でHTML抽出とAI補完へ進む。主催者が手入力した商品個数は上書きしない。
- `proposal.html` / `apply.html` は CDN の React / ReactDOM / LIFF SDK を直接読むため、実際の LIFF 確認時はオンライン環境が必要。
- MVP の n8n 実装方針、Sheets ヘッダ、allowlist 例は `../n8n-mvp/` を参照する。
