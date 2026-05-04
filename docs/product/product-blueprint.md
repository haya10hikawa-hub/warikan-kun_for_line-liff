# Warikan-kun Product Blueprint

この文書は、ルート `README.md` を実装へ落とすための基準です。迷ったら、機能量ではなく手軽さを優先します。

## ファイル設計

Warikan-kun は、検証用の軽い入口と、GMVを積める商用コアを分けます。

- `README.md`
  - 原点、思想、事業仮説、スケール方針の正。
- `docs/product/product-blueprint.md`
  - ファイル設計、デザイン、動線、処理フローの実装基準。
- `docs/product/ui-ux-standards.md`
  - 余白、文字サイズ、ボタン、フォーム、状態表示の数値規格。
- `line-liff/`
  - 主催者の募集作成画面と、その他数量・再編集用画面。
  - 参加者の通常操作は LINE グループ内で終わらせる。
- `warikan-api/`
  - proposal, application, order, payment, notification, audit を所有する商用コア。
  - PostgreSQL 移行、冪等 write、イベント化、決済差し替えの基準。
- `n8n-mvp/`
  - MVP検証、CS通知、管理者承認、失敗通知、簡易レポート用。
  - 商用取引台帳や決済本体にはしない。

## デザイン設計

画面は「1画面1主行動」に固定します。綺麗さより、迷わず終わることを優先します。具体的な数値は `docs/product/ui-ux-standards.md` を正とします。

- 角丸は 8px、影は弱くする。
- 主CTAは1つだけ強くする。
- 説明文は短く、操作名は具体的にする。
- 案件IDや内部IDを参加者の主画面に出さない。
- 主催者画面は標準表示を必要項目だけに寄せる。
- 楽天検索、PayPay ID、補足文、商品URLは必要な時だけ出す。
- 参加者向け画面は「その他数量・再編集」だけを扱う。
- グループに出す情報と、個別に送る情報を混ぜない。

## 動線設計

### 主催者

```text
proposal.html
↓
商品名 / 金額 / 個数 / 希望個数 / 締切
（PayPay ID 未保存なら PayPay ID）
↓
募集開始
↓
botがグループへ募集カード投稿
↓
投稿成功で完了画面
↓
5秒後にLIFFを閉じる
```

主催者が考えることは「何を、いくらで、何個、自分はいくつ、いつまで」です。初利用で支払い先が未保存の場合だけ、PayPay ID も標準表示して投稿前に保存します。

### 参加者

```text
LINEグループの募集カード
↓
欲しい
↓
1個 / 2個 / 3個 / その他
↓
1-3個はチャット内で保存
↓
その他だけ apply.html?mode=other
```

参加者に案件IDを打たせません。1-3個の標準応募では LIFF を開かせません。

### 支払い以降

```text
応募保存
↓
友だち追加状態を確認
↓
個別に送れるなら支払い案内
↓
送れないならグループに友だち追加導線
↓
支払い証跡 / 催促 / 完了通知
```

金額、支払い先、証跡などの個別情報はグループに出しません。

## 処理フロー設計

### `proposal/create`

- `idToken` と `idempotencyKey` を必須にする。
- `productName`, `totalPrice`, `itemCount`, `hostWantedCount`, `deadlineAt`, `paymentId` を検証する。
- `groupId` がなければ募集を作らず、LINEグループ内から開き直す案内を返す。
- `paymentId` がなければ募集を作らず、PayPay ID 入力案内を返す。
- `managementId` を採番する。
- 作成成功時に主催者プロフィールへ PayPay ID と初回募集日時を保存する。
- 募集カードと応募URLを生成する。
- 同一リクエスト内で LINE グループへ bot 投稿する。
- 投稿成功時だけ `postStatus.delivered=true` を返す。
- 投稿失敗時は募集と通知状態を残し、再試行できる `managementId` を返す。
- `proposal_created`, `notification_requested`, `notification_delivered` または `notification_failed` をイベント化する。

### `proposal/:managementId/post`

- 未投稿または投稿失敗済みの募集を再投稿する。
- すでに投稿済みなら再送せず `postStatus.delivered=true` を返す。
- `managementId + line_group_proposal_card` で二重投稿を防ぐ。

### `line/webhook`

- LINE署名を検証する。
- `action=want` は `1個 / 2個 / 3個 / その他` を reply する。
- `action=apply` は `wantedCount=1|2|3` だけ受け付ける。
- `action=other_quantity` は `apply.html?managementId=...&mode=other` を返す。
- webhook retry に備えて LINE event id を `idempotencyKey` にする。
- 保存後は `application_applied` をイベント化する。

### `application/upsert`

- LIFF fallback と LINE postback の保存先を同じにする。
- `managementId + lineUserId` を一意キーにする。
- 再応募は数量更新にする。
- audit log に before / after を残す。
- 未登録参加者でも最小プロフィールを作り、初回応募日時を保存する。
- DM可能なら `payment_handoff_ready`、不可なら `dm_failed` をイベント化する。
- 返却値に `dmReachable`, `friendRequired`, `addFriendUrl` を含める。

### `payment`

- MVPでは PayPay ID と案内文生成まで。
- 注文単位の `payment_requested` を作る。
- PMF後に PayPay Web Payment または PSP へ差し替える。
- webhook だけを信用せず、定期照合で `paid` へ復旧できるようにする。

## 受け入れ基準

- 主催者が必要項目だけで募集を開始できる。
- PayPay ID 保存済みなら補助設定を閉じたままでも募集が完了する。
- PayPay ID 未保存の初回主催者では、PayPay ID が標準表示される。
- 募集完了は LINE グループ投稿成功後だけ表示される。
- 投稿成功後、完了画面は5秒後に LIFF を閉じる。
- 投稿失敗時は再試行だけを主導線にする。
- 参加者が案件IDを手入力しない。
- `1個 / 2個 / 3個` はチャット内で保存まで完了する。
- `その他` だけ LIFF に進む。
- 同じ参加者の再応募は1行更新になり、重複しない。
- LINE webhook の重複受信で二重計上されない。
- 支払い以降の個別情報はグループに出さない。
- 全 write API に `idempotencyKey` がある。
