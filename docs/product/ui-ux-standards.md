# Warikan-kun UI/UX Standards

この規格は、Warikan-kun のアプリ画面を実装するときの数値基準です。目的は、LINEグループの自然な導線を崩さず、主催者と参加者が迷わず操作を終えられる状態を保つことです。

## Design Tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#f8f8fb` | アプリ背景 |
| `surface` | `#ffffff` | パネル、カード、入力面 |
| `textPrimary` | `#1d1c1d` | 本文、見出し |
| `textSecondary` | `#616061` | 補足、ラベル |
| `border` | `#d8d8dc` | 入力、カード境界 |
| `primary` | `#ff7a00` | 主CTA |
| `primaryHover` | `#d95f00` | 主CTA hover、強調テキスト |
| `primarySoft` | `rgba(255, 122, 0, 0.12)` | 選択状態、薄い強調 |
| `linkBlue` | `#1264a3` | リンク、情報系チップ |
| `successBg` | `#ecfdf3` | 成功通知背景 |
| `successText` | `#027a48` | 成功通知文字 |
| `warningBg` | `#fff7d6` | 注意通知背景 |
| `warningText` | `#7b5a05` | 注意通知文字 |
| `errorBg` | `#fff2ef` | エラー通知背景 |
| `errorText` | `#b42318` | エラー通知文字 |

### Typography

| Role | Size | Line height | Weight | Notes |
| --- | ---: | ---: | ---: | --- |
| Body | `14px` | `1.55` | `400` | アプリ本文 |
| Small / hint | `13px` | `1.45` | `400` | 補足文 |
| Label | `13px` | `1.45` | `800` | 入力ラベル |
| Micro label | `11px` | `1.3` | `800` | 小さな状態ラベル、`letter-spacing: 0.08em` |
| Input | `16px` | `1.4` | `400` | 通常入力 |
| Card title | `20px` | `1.25` | `800` | パネル見出し |
| Screen title | `28px` | `1.12` | `800` | 画面見出し |

アプリUIでは viewport-based font scaling を使いません。`clamp()`, `vw` による文字サイズ調整は、公開ページなどのマーケティング面だけに限定します。

### Spacing

| Token | Value | Use |
| --- | ---: | --- |
| Base unit | `4px` | すべての余白の基準 |
| Page padding mobile | `12px` | `<640px` の左右余白 |
| Page padding desktop | `16px` | 通常の左右余白 |
| Section gap | `14px` | パネル間、主要ブロック間 |
| Field gap | `8px` | ラベルと入力の間 |
| Form grid gap | `12px` | フォームグリッド |
| Panel padding | `16px` | パネル内側 |
| Header bottom margin | `16px` | ヘッダー下 |
| Sticky action padding | `16px` | 固定CTA領域 |
| Button horizontal padding | `18px` | ボタン左右 |

### Radius / Shadow

| Token | Value | Use |
| --- | --- | --- |
| Default radius | `8px` | 入力、ボタン、カード、パネル |
| Pill radius | `999px` | チップ、バッジのみ |
| Default shadow | `0 1px 2px rgba(29,28,29,0.08), 0 6px 18px rgba(29,28,29,0.04)` | 控えめな浮き |

`12px` を超える角丸は原則使いません。例外は pill だけです。装飾目的の強い影、カードの入れ子、浮いたセクションの多用は禁止します。

## Component Standards

### Page Layout

- Mobile-first.
- Main content max width: `760px`.
- Desktop max width for two-column forms: `1120px`.
- Desktop breakpoint: `900px`.
- Mobile breakpoint: `640px`.
- LIFF app screens (`index.html`, `proposal.html`, `apply.html`) はスマホ特化のため、`>=900px` でも最大幅 `430px` 前後の1カラムを維持する。
- `<640px` ではフォーム、ボタン、メトリクスのグリッドを1カラムにする。

### Buttons

Primary CTA:

- Height: `48px`
- Width: `100%`
- Padding: `0 18px`
- Background: `#ff7a00`
- Text: `#ffffff`
- Font weight: `800`
- Radius: `8px`

Secondary button:

- Height: `48px`
- Width: `100%`
- Background: `#ffffff`
- Border: `1px solid rgba(30,111,209,0.18)`
- Text: `#0f4f82`
- Font weight: `800`
- Radius: `8px`

Text button:

- Height: `32px`
- Padding: `0 8px`
- Color: `#d95f00`
- Background: transparent

Disabled:

- Opacity: `0.6`
- Hover transform なし
- 近くの copy で何が不足しているかを示す

### Forms

- Input height: `min-height: 48px`
- Large input height: `min-height: 50px`
- Input padding: `12px 14px`
- Input border: `1px solid #d8d8dc`
- Focus ring: `0 0 0 3px rgba(18,100,163,0.12)`

Required proposal fields:

- 商品名
- 合計金額
- 商品個数
- 希望個数
- 締切日時
- PayPay ID, only when no saved PayPay ID exists

Optional proposal fields:

- 楽天検索
- PayPay ID, only when already saved and hidden from the standard path
- 支払いラベル
- 補足文
- 商品URL

商品個数の推定状態ラベル:

- Position: 商品個数ラベルの右側
- Height: `22px`
- Padding: `0 8px`
- Radius: `999px`
- Font size: `11px`
- Font weight: `800`
- 表示文言: `解析中`, `AI解析中`, `自動入力済み`, `手入力してください`, `手入力を優先`
- 主催者が商品個数を手入力した後は、自動推定で上書きしない。

### Cards / Panels

- Panel padding: `16px`
- Panel radius: `8px`
- Panel gap: `14px`
- Repeated item card padding: `12px 14px`
- パネルやカードを装飾カードの中に入れない

### Quantity Input

LINE chat standard quantities:

- `1個`
- `2個`
- `3個`
- `その他`

LIFF other quantity screen:

- Layout: `56px / 1fr / 56px`
- Minus/plus button height: `52px`
- Quantity input font size: `22px`
- Quantity input font weight: `900`
- Minimum value: `1`

## Screen Standards

### Proposal Screen

- Header title: `募集を開始する`
- Header copy: `必要な項目だけ入力してグループ募集を始めます。`
- Main sections:
  - `商品を決める`
  - `募集条件を決める`
  - `支払い先と補足` only when expanded
- Step 1 fields:
  - 商品名
  - 合計金額
  - 商品個数
  - 希望個数
- Search is an icon button inside the 商品名 input area.
- Search result selection immediately fills `商品名`, `商品URL`, `合計金額`.
- 商品個数は第1層 regex で高信頼なら即時入力し、未確定なら `解析中` → `AI解析中` を表示する。
- API後追い結果は `autoApply=true` のときだけ商品個数へ反映する。
- Primary CTA: `募集を開始する`
- 初期表示では商品URL、検索結果説明を出さない。
- PayPay ID は未保存時だけ Step 2 に標準表示する。保存済みなら詳細内に置く。
- グループ外起動ではフォームを出さず、`グループで開き直してください` を表示する。
- Success state appears only after LINE group post delivery.
- Success state must show:
  - Large title: `LINEに戻ります`
  - Large countdown: `5秒`
  - Status copy: `募集はグループに投稿済み`
  - 商品名
- After 5 seconds, close the LIFF window with `liff.closeWindow()`.
- Failed post state must show:
  - `投稿できませんでした`
  - reason copy
  - `再試行`

### Apply / Other Quantity Screen

- Header title: `その他数量・再編集`
- Header copy: `1〜3個以外の数だけ保存します。`
- Main sections:
  - `募集内容`
  - `欲しい数を保存する`
- Primary CTA: `この数で保存`
- `managementId` を主表示しない。
- Success state:
  - `応募内容を保存しました`
  - 商品名
  - 応募数
  - `次の案内は個別に届きます`

### Missing Link State

- Title: `募集が見つかりません`
- Copy: `LINEグループの応募リンクから開き直してください。`
- management ID の手入力を求めない。

## UX Rules

- 1画面1主行動にする。
- 参加者の標準導線は `欲しい -> 1個/2個/3個 -> 応募済み` に固定する。
- `その他` と数量再編集だけ参加者向け画面を使う。
- 支払い、催促、証跡、完了通知は個別案内を標準にする。
- グループ投稿には個人の支払い先や証跡を含めない。

User-facing UI で禁止する内部用語:

- `idempotencyKey`
- `postback`
- `webhook`
- `API`
- `managementId`
- `DM分離`
- `LIFF`

`LIFF` は開発者向けドキュメントでは使用可です。

## Acceptance Checks

- Visual check at widths `375px`, `430px`, `768px`, `1120px`.
- `index.html`, `proposal.html`, `apply.html` が同じ `430px` スマホ規格で表示される。
- Proposal screen shows only required fields before optional expansion.
- Apply screen saves quantity without exposing internal IDs.
- Product count inference never overwrites a manually edited value.
- Primary CTA count is one per screen state.
- Text does not overflow buttons, cards, or inputs.
- Existing checks still pass:
  - `node --check line-liff/assets/react-app.js`
  - `node --check line-liff/assets/liff-app.js`
  - `npm test` in `warikan-api`

## Assumptions

- This standard is the source of truth for app UI.
- Public marketing pages may be more expressive.
- LIFF app screens stay quiet, compact, and task-focused.
- Existing colors are kept to avoid unnecessary redesign churn.
