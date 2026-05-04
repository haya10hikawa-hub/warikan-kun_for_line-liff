# Rakuten API Integration Settings and Display Design

## 1. API Settings
- Use the official **Rakuten Ichiba Item Search API** current version endpoint:
  - `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401`
- Required request parameters:
  - `applicationId`
  - `accessKey`
  - `keyword`
- Optional but recommended parameters:
  - `affiliateId`
  - `hits=3`
  - `format=json`
  - `formatVersion=2`
  - `elements=itemName,itemPrice,itemUrl,shopName,mediumImageUrls`
- Keep the Rakuten credentials only in n8n environment variables:
  - `RAKUTEN_APPLICATION_ID`
  - `RAKUTEN_ACCESS_KEY`
  - `RAKUTEN_AFFILIATE_ID`

## 2. n8n Search Logic
- Trigger only from the Proposal LIFF.
- Search input is the single free-text product name the host types.
- Normalize the keyword before caching:
  - trim whitespace
  - collapse repeated spaces
  - convert full-width spaces to half-width
- Cache each query in `商品候補キャッシュDB`.
- Return at most 3 candidates.
- Candidate sort order:
  - first: `shopName` matches `RAKUTEN_OFFICIAL_SHOPS`
  - second: lower `itemPrice`
  - third: stable original API order

## 3. Display Design in Proposal LIFF
- Keep the search UI inside **Step 1 商品を決める**.
- Interaction flow:
  - host types `productName`
  - taps the search icon inside the product name field
  - sees up to 3 cards
  - taps 1 card to apply it into the form
- Each result card should show only:
  - platform badge: `RAKUTEN`
  - `itemName`
  - `shopName`
  - `itemPrice`
- Do not show long descriptions, review counts, or metadata in MVP.
- When the host selects a result:
  - fill `productName`
  - fill `productUrl`
  - fill `totalPrice`
  - run immediate LIFF regex inference for `itemCount`
  - if regex is not confident, call `POST /api/liff/products/infer-count`
  - update `itemCount` only when `autoApply=true`
  - never overwrite `itemCount` after the host has typed it manually

## 4. UX Rules
- Search must be optional. The host can always continue with manual input.
- Search failure must not block proposal creation.
- If zero results:
  - show a short warning
  - keep all manual inputs enabled
- If multiple results exist:
  - do not auto-select one silently
  - require an explicit tap by the host
- Preserve the host's typed value until a result is explicitly chosen.

## 5. Display Copy
- Search uses only the icon button in the product name field.
- Empty result copy: `候補が見つかりませんでした。手入力で続けてください。`
- Error copy: `楽天検索に失敗しました。あとで再試行するか、手入力で続けてください。`
- Success copy after selection: `商品候補をフォームへ反映しました。`
- Item count inference status:
  - `解析中`
  - `AI解析中`
  - `自動入力済み`
  - `手入力してください`

## 6. MVP Boundaries
- Rakuten only in this slice.
- No Amazon search in this slice.
- Automatic item count inference is allowed only after explicit candidate selection.
- High-confidence results may auto-fill; low-confidence results keep manual input.
- No hidden ranking logic beyond official-shop priority and price order.

## Official Sources
- Rakuten Ichiba Item Search API: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
- Rakuten Web Service Application ID help: https://webservice.faq.rakuten.net/hc/en-us/articles/900001970586-What-is-the-Application-ID
