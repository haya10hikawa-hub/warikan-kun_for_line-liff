# n8n Workflow Blueprint

## 1. `profile/bootstrap`
- Webhook node で `POST /api/liff/profile/bootstrap`
- `idToken` が無ければ 400
- HTTP Request node で `POST https://api.line.me/oauth2/v2.1/verify`
  - Body: `id_token`, `client_id`
  - Header: `Content-Type: application/x-www-form-urlencoded`
- `sub` と `name` を取得
- allowlist JSON を読み、`sub` が許可済みか確認
- `主催者プロフィールDB` を `lineUserId` で検索
- 無ければ初回ユーザーとして作成し、`isFirstUse=true` と `profileCompleteness.hasDefaultPayPayId` を返す
- あればその既定値を返し、`isFirstUse=false` を返す

## 2. `proposal/create`
- Webhook node で `POST /api/liff/proposal/create`
- `idToken` を上と同じ verify 処理へ通す
- 必須入力 `productName`, `totalPrice`, `itemCount`, `hostWantedCount`, `deadlineAt`, `paymentId` を検証
- LIFF context 由来の `groupId` / `roomId` が無ければ proposal を作らず `group_context_required` を返す
- `paymentId` が無ければ proposal を作らず `payment_id_required` を返す
- `managementId` を `WK-YYYYMMDD-####` 形式で採番
- `案件DB` に `status=collecting` で追加
- `主催者プロフィールDB` を upsert し、PayPay ID と `firstProposalCreatedAt` を保存する
- `WARIKAN_PUBLIC_BASE_URL` から apply URL を組み立てる
- `messageCard` を生成する
  - 表示: `商品名`, `合計金額`, `商品個数`, `希望単価`, `締切`, `受付状態`
  - 主CTA: `欲しい`
  - postback: `action=want&managementId=...`
- LINE Messaging API で募集カードを push する
- 投稿成功時だけ `postStatus.delivered=true` を返す
- 投稿できない場合は通知状態を `failed` で残し、`line_post_failed` と `managementId` を返す

## 3. `products/search`
- Webhook node で `GET /api/liff/products/search`
- `keyword` が空なら 400
- HTTP Request node で楽天市場商品検索 API を叩く
  - Endpoint: `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401`
  - Query: `applicationId`, `accessKey`, `affiliateId`, `keyword`, `hits=3`, `format=json`, `formatVersion=2`, `elements=itemName,itemPrice,itemUrl,shopName,mediumImageUrls`
- `RAKUTEN_OFFICIAL_SHOPS` の shopName 一致を優先し、それ以外は価格昇順
- `商品候補キャッシュDB` に保存
- LIFF 向けに `itemName`, `itemUrl`, `price`, `shopName`, `imageUrl`, `platform` へ整形して返す

## 4. `products/infer-count`
- Webhook node ではなく `warikan-api` の `POST /api/liff/products/infer-count` を使う
- LIFF内 regex で確定しない検索候補だけ送る
- HTMLは `title`, `meta`, `table`, `item_name`, JSON-LD 商品情報だけを抽出する
- HTMLで確定しない場合だけ OpenAI 補完に進む
- `autoApply=true` のときだけ LIFF が `itemCount` を更新する
- 主催者が商品個数を手入力済みなら上書きしない

## 5. `proposal/:managementId`
- Webhook node で `GET /api/liff/proposal/:managementId`
- `案件DB` から一致行を読む
- 行が無ければ 404
- `status !== collecting` または `deadlineAt <= now` なら、その状態を返しつつ応募画面では送信不可にする

## 6. `line/webhook`
- Webhook node で `POST /api/line/webhook`
- `X-Line-Signature` を検証する
- postback data を parse する
- `action=want`
  - `案件DB` から案件を読む
  - 受付中なら `1個 / 2個 / 3個 / その他` の数量選択を reply する
  - `その他` は `action=other_quantity` の postback にする
- `action=apply`
  - `wantedCount` が `1`, `2`, `3` のいずれかか検証する
  - `source.userId`, `source.groupId`, `managementId` で `application/upsert` と同じ保存処理を呼ぶ
  - グループ内に「応募済み」を reply する
  - 友だち追加前または DM 状態不明なら「個別案内を受けるには友だち追加」を添える
- `action=other_quantity`
  - `apply.html?managementId=...&mode=other` の LIFF URL を reply する

## 7. `application/upsert`
- Webhook node で `POST /api/liff/application/upsert`
- `idToken` を verify
- `managementId` と `wantedCount` を検証
- `案件DB` から対象案件を読み、`status=collecting` かつ締切前か確認
- `applicantManagementId = managementId + ":" + lineUserId` を生成
- 未登録参加者なら `主催者プロフィールDB` に最小ユーザーを作り、`firstApplicationAppliedAt` を保存する
- `応募DB` を検索
  - あれば更新
  - 無ければ追加
- `status=applied` で返す
- 保存形式は chat button 経由でも LIFF 経由でも同じにする
  - `wantedCount`
  - `status=applied`
  - `updatedAt`
- 返却時に `dmReachable`, `friendRequired`, `addFriendUrl` を付ける

## 8. 支払い案内テンプレート
- PayPay 実 API 連携はしない
- `案件DB.paymentId`, `案件DB.paymentLabel`, `managementId`, `wantedCount`, `unitPrice` から案内文を生成する
- 送信先は 1:1 DM
- DM 送信不可の場合はグループ返信で友だち追加導線のみ返し、金額や個別情報を公開しない

## 9. 投稿失敗時の再試行
- `proposal/create` はグループ投稿成功を完了条件にする
- `groupId` が無い場合は proposal を作らず、LINEグループ内から開き直す案内を返す
- bot 投稿に失敗した場合は proposal と通知状態を `failed` で残し、`managementId` を返す
- 主催者画面は手動共有ではなく `proposal/:managementId/post` の再試行を主導線にする
- 参加者に案件ID手入力を要求しない
