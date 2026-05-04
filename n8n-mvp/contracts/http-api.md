# HTTP API Contract

## Surface split
- 主催者は `proposal.html` から `proposal/create` を呼び、募集カード投稿に必要な `applyUrl` と LINE postback 情報を受け取る。
- 参加者の通常導線は LINE グループ内のメッセージカード。`1個 / 2個 / 3個` は Messaging API webhook で保存まで完了する。
- `その他` と再編集のみ `apply.html?managementId=...` を開く。
- 支払い案内、証跡提出、注文催促、完了通知は応募後に 1:1 DM へ切り替える。友だち追加前ユーザーにはグループ返信で追加導線を返す。

## `POST /api/liff/profile/bootstrap`
### Request
```json
{
  "idToken": "LIFF_ID_TOKEN",
  "idempotencyKey": "profile:uuid"
}
```

### Response
```json
{
  "lineUserId": "U123...",
  "displayName": "Hayato",
  "isFirstUse": true,
  "profileCompleteness": {
    "hasDefaultPayPayId": false
  },
  "defaults": {
    "defaultPayPayId": "hayato-paypay",
    "defaultPaymentLabel": "PayPay",
    "defaultDeadlineHour": "21:00",
    "defaultNotes": "学内受け渡し予定です。"
  },
  "available": true
}
```

## `POST /api/liff/proposal/create`
### Request
```json
{
  "idToken": "LIFF_ID_TOKEN",
  "idempotencyKey": "proposal:uuid",
  "proposal": {
    "groupId": "C123...",
    "productName": "コカ・コーラ 500ml 24本",
    "productUrl": "https://item.rakuten.co.jp/example/item/",
    "totalPrice": 4980,
    "itemCount": 24,
    "hostWantedCount": 1,
    "deadlineAt": "2026-05-04T21:00",
    "paymentId": "hayato-paypay",
    "paymentLabel": "PayPay",
    "notes": "学内受け渡し予定です。"
  }
}
```

### Response
```json
{
  "managementId": "WK-20260502-0001",
  "status": "collecting",
  "applyUrl": "https://your-pages-domain.example.com/line-liff/apply.html?managementId=WK-20260502-0001",
  "messageCard": {
    "altText": "共同購入募集: コカ・コーラ 500ml 24本",
    "fields": {
      "productName": "コカ・コーラ 500ml 24本",
      "totalPrice": 4980,
      "itemCount": 24,
      "unitPrice": 208,
      "deadlineAt": "2026-05-04T21:00",
      "statusLabel": "応募受付中"
    },
    "primaryAction": {
      "label": "欲しい",
      "type": "postback",
      "data": "action=want&managementId=WK-20260502-0001"
    },
    "fallbackUri": "https://your-pages-domain.example.com/line-liff/apply.html?managementId=WK-20260502-0001"
  },
  "postStatus": {
    "attempted": true,
    "delivered": true,
    "targetGroupId": "C123..."
  }
}
```

`groupId` が空の場合は proposal を作らず `group_context_required` を返します。`paymentId` が空の場合も proposal を作らず `payment_id_required` を返します。bot が対象グループに投稿できない場合は proposal を残し、通知状態を `failed` にして `line_post_failed` と `managementId` を返します。主催者 LIFF では手動共有を主導線にせず、同じ `managementId` の再試行画面を表示します。

## `POST /api/line/webhook`
LINE Messaging API からの webhook。`X-Line-Signature` を検証してから postback を処理します。

### Quantity selection postbacks
```text
action=want&managementId=WK-20260502-0001
action=apply&managementId=WK-20260502-0001&wantedCount=1
action=apply&managementId=WK-20260502-0001&wantedCount=2
action=apply&managementId=WK-20260502-0001&wantedCount=3
action=other_quantity&managementId=WK-20260502-0001
```

### Behavior
- `want`: グループ内で `1個 / 2個 / 3個 / その他` の数量選択を reply する。
- `apply`: `source.userId + source.groupId + managementId + wantedCount` を使い、`application/upsert` と同じ保存処理へ通す。
- `other_quantity`: `applyUrl` に `mode=other` を付けて返し、LIFF で任意数量を入力させる。
- `apply` の `wantedCount` はチャット内では `1`, `2`, `3` のみ受け付ける。
- 応募保存後はグループに「応募済み」を返す。DM が未送達の可能性がある場合は「個別案内を受けるには友だち追加」を添える。

## `GET /api/liff/products/search?keyword=...`
### Response
```json
{
  "items": [
    {
      "itemName": "コカ・コーラ 500ml 24本",
      "itemUrl": "https://item.rakuten.co.jp/example/item/",
      "price": 4980,
      "shopName": "Rakuten 24",
      "imageUrl": "https://thumbnail.image.rakuten.co.jp/@0_mall/example/cabinet/item.jpg",
      "platform": "rakuten"
    }
  ]
}
```

## `POST /api/liff/products/infer-count`
検索候補を主催者がタップした後に呼ぶ。LIFF内の即時正規表現で確定しない場合、API側で安全タグ抽出とAI補完を行う。主催者がすでに `itemCount` を手入力している場合、クライアントはこの結果で上書きしない。

### Request
```json
{
  "itemName": "コカ・コーラ 500ml 24本",
  "itemUrl": "https://item.rakuten.co.jp/example/item/",
  "price": 4980,
  "shopName": "Rakuten 24"
}
```

### Response
```json
{
  "itemCount": 24,
  "unit": "本",
  "confidence": 0.92,
  "sourceLayer": "regex",
  "reason": "24本 から推定",
  "autoApply": true
}
```

### Behavior
- `sourceLayer` は `regex`, `html`, `ai`, `none` のいずれか。
- `autoApply=true` のときだけ、クライアントは商品個数を自動入力してよい。
- HTML解析は `title`, `meta`, `table`, `item_name`, JSON-LD 商品情報だけを対象にする。
- 低 confidence、timeout、HTML取得失敗、AI失敗では `autoApply=false` を返す。

## `GET /api/liff/proposal/:managementId`
応募 LIFF は `apply.html?managementId=...` のリンク起動を前提にし、この API はその URL から受け取った `managementId` で案件概要を返します。案件IDの手入力 fallback は持ちません。

### Response
```json
{
  "managementId": "WK-20260502-0001",
  "productName": "コカ・コーラ 500ml 24本",
  "totalPrice": 4980,
  "itemCount": 24,
  "deadlineAt": "2026-05-04T21:00",
  "status": "collecting",
  "notes": "学内受け渡し予定です。"
}
```

## `POST /api/liff/application/upsert`
### Request
```json
{
  "idToken": "LIFF_ID_TOKEN",
  "idempotencyKey": "application:uuid",
  "managementId": "WK-20260502-0001",
  "wantedCount": 2
}
```

`managementId` は主催者が共有した `applyUrl` の query param から取得される前提です。
商用コア API では retry / double tap 対策として、すべての write request に `idempotencyKey` を付けます。

### Response
```json
{
  "applicantManagementId": "WK-20260502-0001:U123...",
  "managementId": "WK-20260502-0001",
  "wantedCount": 2,
  "status": "applied",
  "updated": true,
  "dmReachable": false,
  "friendRequired": true,
  "addFriendUrl": "https://lin.ee/..."
}
```

`dmReachable` は応募後の支払い案内・証跡提出・完了通知を 1:1 DM で送れるかを表します。MVP では LINE の友だち状態確認に失敗した場合も `false` として扱い、グループ内の追加導線で補完します。

## Error shape
```json
{
  "error": "forbidden",
  "message": "This LINE account is not allowed in the MVP environment."
}
```
