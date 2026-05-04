# Warikan-kun LINE MVP Backend Kit

このディレクトリは、LIFF フロントを **n8n + Google Sheets + 楽天検索** に接続するための実装資材です。

## 含まれるもの
- `env.example`: n8n 側で必要な環境変数一覧
- `allowlists.example.json`: テスト参加者とテストグループの許可制設定例
- `contracts/http-api.md`: LIFF フロントが叩く API 契約
- `workflows/README.md`: n8n workflow の endpoint ごとの処理手順
- `docs/rakuten-search-design.md`: 楽天市場 API 設定と LIFF 上の表示設計
- `sheets/*.csv`: Google Sheets のヘッダ行テンプレート

## このキットの使い方
1. `sheets/*.csv` をそのまま Google Sheets の各タブへ貼る
2. `env.example` をもとに n8n の環境変数を埋める
3. `allowlists.example.json` をテスト用 `lineUserId` と `groupId` に置き換える
4. `contracts/http-api.md` に合わせて n8n の HTTP endpoint workflow を作る
5. `workflows/README.md` の順で `profile/bootstrap` → `proposal/create` → `line/webhook` → `proposal/:id` → `application/upsert` → `products/search` を組む

## MVP 完了条件
- `profile/bootstrap` が `idToken` を検証し、既定値を返す
- `proposal/create` が `managementId` を採番し、`案件DB` に保存し、募集カードまたは共有文を返す
- `line/webhook` が `欲しい` から `1個 / 2個 / 3個 / その他` の数量導線を返す
- `products/search` が楽天候補を返す
- `application/upsert` が chat button 経由と LIFF 経由を同じ形で `応募DB` に upsert する
- 応募後の個別案内は 1:1 DM 前提とし、友だち追加前ユーザーには追加導線を返す
