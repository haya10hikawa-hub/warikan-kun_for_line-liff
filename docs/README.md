# Warikan-kun Docs

この `docs/` は、Warikan-kun の外部向け説明と設計要約を置く場所です。

## 公開ファイル

- `index.html`
  - README の原点に基づいたプロダクトページ。
- `product/product-blueprint.md`
  - ファイル設計、デザイン、動線、処理フローの基準。
- `product/ui-ux-standards.md`
  - 余白、文字サイズ、ボタン、フォーム、状態表示の数値規格。
- `reports/classroom-report.md`
  - 提出・説明用の簡易レポート。

## GitHub Pages 設定

1. GitHub にリポジトリを push する
2. リポジトリの `Settings` を開く
3. 左メニューの `Pages` を開く
4. `Build and deployment` の `Source` を `Deploy from a branch` にする
5. Branch を `main`、Folder を `/docs` にする
6. `Save` を押す

## 方針

- 旧Slack版ではなく、LINEグループ共同購入の3タップ体験を正とする。
- 公開ページは機能羅列ではなく、手軽さ、LINE導線、DM分離、商用コアへの拡張を伝える。
- 実装判断に迷ったら、ルート `README.md`、`product/product-blueprint.md`、`product/ui-ux-standards.md` を優先する。
