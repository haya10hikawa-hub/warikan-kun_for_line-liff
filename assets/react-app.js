(function renderWarikanLiffApp(windowObject, documentObject) {
  const { React, ReactDOM } = windowObject;
  const h = React.createElement;

  function formatYen(value) {
    const amount = Number(value || 0);
    if (!amount) {
      return "-";
    }
    return `${amount.toLocaleString("ja-JP")}円`;
  }

  function calculateUnitPrice(totalPrice, itemCount) {
    const total = Number(totalPrice || 0);
    const count = Number(itemCount || 0);
    if (!total || !count) {
      return null;
    }
    return Math.ceil(total / count);
  }

  function isCollectingProposal(proposal) {
    if (!proposal) {
      return false;
    }
    if (proposal.status && proposal.status !== "collecting") {
      return false;
    }
    if (!proposal.deadlineAt) {
      return true;
    }
    return new Date(proposal.deadlineAt).getTime() > Date.now();
  }

  function formatProposalSummary(proposal) {
    if (!proposal) {
      return "案件情報はまだ読み込まれていません。";
    }

    const statusLabel = proposal.status || "collecting";
    return `${proposal.productName || "商品名未設定"} / 合計 ${formatYen(proposal.totalPrice)} / 締切 ${proposal.deadlineAt || "-"} / 状態 ${statusLabel}`;
  }

  function getSearchItems(response) {
    if (!response) {
      return [];
    }
    if (Array.isArray(response)) {
      return response;
    }
    if (Array.isArray(response.items)) {
      return response.items;
    }
    return [];
  }

  function ScreenRoot() {
    const screen = documentObject.body.dataset.screen || "proposal";
    const [phase, setPhase] = React.useState("booting");
    const [context, setContext] = React.useState(null);
    const [status, setStatus] = React.useState(null);
    const [result, setResult] = React.useState(null);
    const [proposalSummary, setProposalSummary] = React.useState(null);
    const [loadingSummary, setLoadingSummary] = React.useState(false);
    const [showOptional, setShowOptional] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const [searchKeyword, setSearchKeyword] = React.useState("");
    const [searchLoading, setSearchLoading] = React.useState(false);
    const [searchError, setSearchError] = React.useState("");
    const [searchResults, setSearchResults] = React.useState([]);
    const [proposalForm, setProposalForm] = React.useState({
      productName: "",
      productUrl: "",
      totalPrice: "",
      itemCount: "",
      hostWantedCount: "1",
      deadlineAt: "",
      paymentId: "",
      paymentLabel: "PayPay",
      notes: ""
    });
    const [applyForm, setApplyForm] = React.useState({
      managementId: "",
      wantedCount: "1"
    });

    React.useEffect(() => {
      let alive = true;

      async function boot() {
        try {
          const nextContext = await windowObject.WarikanLiffRuntime.bootstrap(screen);
          if (!alive || !nextContext || nextContext.redirecting) {
            return;
          }

          setContext(nextContext);
          setProposalForm(nextContext.initialProposal);
          setApplyForm(nextContext.initialApply);
          setStatus(nextContext.status || null);
          setPhase("ready");
        } catch (error) {
          if (!alive) {
            return;
          }
          setStatus({ kind: "error", message: error.message });
          setPhase("error");
        }
      }

      boot();
      return () => {
        alive = false;
      };
    }, [screen]);

    React.useEffect(() => {
      if (screen !== "apply" || !applyForm.managementId || phase !== "ready") {
        return;
      }

      let alive = true;
      setLoadingSummary(true);
      windowObject.WarikanLiffRuntime.loadProposal(applyForm.managementId)
        .then((data) => {
          if (!alive) {
            return;
          }
          setProposalSummary(data);
          setLoadingSummary(false);
        })
        .catch((error) => {
          if (!alive) {
            return;
          }
          setStatus({ kind: "error", message: error.message });
          setLoadingSummary(false);
        });

      return () => {
        alive = false;
      };
    }, [applyForm.managementId, phase, screen]);

    const unitPrice = calculateUnitPrice(proposalForm.totalPrice, proposalForm.itemCount);
    const applyEnabled = Boolean(applyForm.managementId) && Number(applyForm.wantedCount) > 0 && isCollectingProposal(proposalSummary);
    const createdManagementId = result?.managementId || "";
    const applyUrl = createdManagementId ? windowObject.WarikanLiffRuntime.buildApplyUrl(createdManagementId) : "";

    function updateProposalField(name, value) {
      setProposalForm((current) => ({ ...current, [name]: value }));
      if (name === "productName") {
        setSearchKeyword(value);
      }
    }

    function updateApplyField(name, value) {
      setApplyForm((current) => ({ ...current, [name]: value }));
    }

    function applyProfileDefaults() {
      if (!context?.initialProposal) {
        return;
      }
      setProposalForm((current) => ({
        ...current,
        paymentId: context.initialProposal.paymentId,
        paymentLabel: context.initialProposal.paymentLabel,
        deadlineAt: context.initialProposal.deadlineAt,
        notes: context.initialProposal.notes
      }));
      setStatus({ kind: "success", message: "保存済みプロフィールを反映しました。" });
    }

    function applyQuickDeadline(days) {
      const hour = context?.bootstrapData?.defaults?.defaultDeadlineHour || "21:00";
      updateProposalField("deadlineAt", windowObject.WarikanLiffRuntime.buildDeadlineValue(hour, days));
    }

    async function handleProductSearch() {
      if (!searchKeyword.trim()) {
        setSearchError("商品名を入れてから検索してください。");
        setSearchResults([]);
        return;
      }

      try {
        setSearchLoading(true);
        setSearchError("");
        const response = await windowObject.WarikanLiffRuntime.searchProducts(searchKeyword);
        const items = getSearchItems(response).slice(0, 3);
        setSearchResults(items);
        if (!items.length) {
          setSearchError("候補が見つかりませんでした。手入力で続けてください。");
        }
      } catch (error) {
        setSearchError(error.message || "商品候補の検索に失敗しました。");
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }

    function applySearchItem(item) {
      setProposalForm((current) => ({
        ...current,
        productName: item.itemName || current.productName,
        productUrl: item.itemUrl || current.productUrl,
        totalPrice: item.price ? String(item.price) : current.totalPrice
      }));
      setStatus({ kind: "success", message: "商品候補をフォームへ反映しました。" });
    }

    async function handleProposalSubmit(event) {
      event.preventDefault();
      if (!proposalForm.productName || !proposalForm.deadlineAt || Number(proposalForm.totalPrice) <= 0 || Number(proposalForm.itemCount) <= 0) {
        setStatus({ kind: "error", message: "商品名、合計金額、商品個数、締切を入力してください。" });
        return;
      }

      try {
        setSubmitting(true);
        const response = await windowObject.WarikanLiffRuntime.submitProposal(context.idToken, {
          ...proposalForm,
          totalPrice: Number(proposalForm.totalPrice),
          itemCount: Number(proposalForm.itemCount),
          hostWantedCount: Number(proposalForm.hostWantedCount || 0)
        });
        setResult(response);
        setStatus({ kind: "success", message: "案件を作成しました。グループに応募リンクを貼れば募集を始められます。" });
      } catch (error) {
        setStatus({ kind: "error", message: error.message });
        setResult({ error: error.message });
      } finally {
        setSubmitting(false);
      }
    }

    async function handleApplicationSubmit(event) {
      event.preventDefault();
      if (!applyForm.managementId || Number(applyForm.wantedCount) <= 0) {
        setStatus({ kind: "error", message: "案件ID と希望数を入力してください。" });
        return;
      }
      if (!isCollectingProposal(proposalSummary)) {
        setStatus({ kind: "error", message: "この案件は応募受付中ではありません。" });
        return;
      }

      try {
        setSubmitting(true);
        const response = await windowObject.WarikanLiffRuntime.submitApplication(
          context.idToken,
          applyForm.managementId,
          Number(applyForm.wantedCount)
        );
        setResult(response);
        setStatus({ kind: "success", message: "応募を送信しました。再応募すると数量は上書き更新されます。" });
      } catch (error) {
        setStatus({ kind: "error", message: error.message });
        setResult({ error: error.message });
      } finally {
        setSubmitting(false);
      }
    }

    async function refreshSummary() {
      if (!applyForm.managementId) {
        setStatus({ kind: "error", message: "案件ID を入力してください。" });
        return;
      }

      try {
        setLoadingSummary(true);
        const response = await windowObject.WarikanLiffRuntime.loadProposal(applyForm.managementId);
        setProposalSummary(response);
        setStatus({ kind: "success", message: "案件情報を読み込みました。" });
      } catch (error) {
        setStatus({ kind: "error", message: error.message });
      } finally {
        setLoadingSummary(false);
      }
    }

    async function copyText(value, successMessage) {
      if (!value) {
        return;
      }

      try {
        if (windowObject.navigator?.clipboard?.writeText) {
          await windowObject.navigator.clipboard.writeText(value);
          setStatus({ kind: "success", message: successMessage });
          return;
        }
      } catch (_error) {
      }

      setStatus({ kind: "warning", message: "クリップボードへ自動コピーできませんでした。手動でコピーしてください。" });
    }

    function renderStatus() {
      if (!status) {
        return null;
      }
      return h(
        "div",
        { className: `notice is-${status.kind || "info"}` },
        h("strong", null, status.kind === "error" ? "確認が必要です" : "状態"),
        h("span", null, status.message)
      );
    }

    function renderProfileHeader() {
      return h(
        "div",
        { className: "profile-strip" },
        h(
          "div",
          { className: "profile-copy" },
          h("span", { className: "micro-label" }, "LINE profile"),
          h("strong", null, context?.profile?.displayName || "未取得"),
          h("span", { className: "micro-copy" }, context?.profile?.userId || context?.bootstrapData?.lineUserId || "preview")
        ),
        h(
          "div",
          { className: "profile-badges" },
          h("span", { className: "status-pill" }, context?.preview ? "Preview" : "Connected"),
          h("span", { className: "status-pill secondary" }, context?.isInClient ? "LINE内" : "外部ブラウザ")
        )
      );
    }

    function renderProposalResult() {
      if (!result?.managementId) {
        return result ? h(
          "section",
          { className: "panel debug-panel" },
          h("span", { className: "micro-label" }, "Response"),
          h("pre", { className: "debug-box" }, JSON.stringify(result, null, 2))
        ) : null;
      }

      return h(
        "section",
        { className: "panel success-panel" },
        h("span", { className: "micro-label" }, "Created"),
        h("h2", null, "募集リンクを配れば開始できます"),
        h("div", { className: "result-grid" },
          h("div", { className: "result-item" },
            h("span", { className: "field-label" }, "案件ID"),
            h("strong", null, result.managementId)
          ),
          h("div", { className: "result-item" },
            h("span", { className: "field-label" }, "応募URL"),
            h("a", { href: applyUrl, target: "_blank", rel: "noreferrer", className: "inline-link" }, applyUrl)
          )
        ),
        h("div", { className: "quick-chip-row" },
          h("button", { type: "button", className: "soft-chip", onClick: () => copyText(result.managementId, "案件IDをコピーしました。") }, "案件IDをコピー"),
          h("button", { type: "button", className: "soft-chip", onClick: () => copyText(applyUrl, "応募URLをコピーしました。") }, "応募URLをコピー")
        )
      );
    }

    function renderSearchResults() {
      return h(
        "div",
        { className: "search-shell" },
        h("div", { className: "search-head" },
          h("div", null,
            h("strong", null, "楽天候補を探す"),
            h("p", null, "商品名から最大 3 件まで返し、選んだ候補をフォームへ埋めます。")
          ),
          h("button", { type: "button", className: "soft-chip", onClick: handleProductSearch, disabled: searchLoading }, searchLoading ? "検索中..." : "候補を検索")
        ),
        searchError ? h("p", { className: "search-error" }, searchError) : null,
        searchResults.length ? h(
          "div",
          { className: "search-results" },
          searchResults.map((item, index) =>
            h("button", {
              type: "button",
              className: "search-result-card",
              key: `${item.itemUrl || item.itemName}-${index}`,
              onClick: () => applySearchItem(item)
            },
            h("span", { className: "search-platform" }, (item.platform || "rakuten").toUpperCase()),
            h("strong", null, item.itemName || "商品名なし"),
            h("span", { className: "search-meta" }, `${item.shopName || "ショップ名なし"} / ${formatYen(item.price)}`))
          )
        ) : h("p", { className: "hint" }, "検索前でも手入力で進められます。")
      );
    }

    function renderProposalScreen() {
      return h(
        React.Fragment,
        null,
        h(
          "section",
          { className: "hero-card compact" },
          h("span", { className: "eyebrow" }, "Proposal LIFF"),
          h("h1", null, "最短入力で募集を作る"),
          h("p", null, "商品名、金額、締切を先に入れ、支払い情報は保存済みプロフィールで補います。MVP では案件作成と応募導線生成までを完結させます。"),
          renderProfileHeader()
        ),
        renderStatus(),
        h(
          "form",
          { className: "content-stack", onSubmit: handleProposalSubmit },
          h(
            "section",
            { className: "panel" },
            h(
              "div",
              { className: "panel-head" },
              h(
                "div",
                null,
                h("span", { className: "micro-label" }, "Step 1"),
                h("h2", null, "商品を決める")
              ),
              h("button", {
                type: "button",
                className: "text-button",
                onClick: () => setShowOptional((current) => !current)
              }, showOptional ? "詳細を閉じる" : "詳細を開く")
            ),
            h("label", { className: "field-shell" },
              h("span", { className: "field-label" }, "商品名"),
              h("input", {
                className: "text-input big",
                value: proposalForm.productName,
                onChange: (event) => updateProposalField("productName", event.target.value),
                placeholder: "例: コカ・コーラ 500ml 24本"
              })
            ),
            renderSearchResults(),
            h(
              "div",
              { className: "field-grid two" },
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "合計金額"),
                h("input", {
                  className: "text-input",
                  inputMode: "numeric",
                  value: proposalForm.totalPrice,
                  onChange: (event) => updateProposalField("totalPrice", event.target.value),
                  placeholder: "4800"
                })
              ),
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "商品個数"),
                h("input", {
                  className: "text-input",
                  inputMode: "numeric",
                  value: proposalForm.itemCount,
                  onChange: (event) => updateProposalField("itemCount", event.target.value),
                  placeholder: "24"
                })
              )
            ),
            unitPrice ? h(
              "div",
              { className: "info-chip" },
              h("span", null, `1個あたり約 ${unitPrice.toLocaleString("ja-JP")} 円`)
            ) : null
          ),
          h(
            "section",
            { className: "panel" },
            h(
              "div",
              { className: "panel-head" },
              h(
                "div",
                null,
                h("span", { className: "micro-label" }, "Step 2"),
                h("h2", null, "募集条件を決める")
              ),
              h("button", { type: "button", className: "text-button", onClick: applyProfileDefaults }, "既定値を反映")
            ),
            h(
              "div",
              { className: "field-grid two" },
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "主催者希望数"),
                h("input", {
                  className: "text-input",
                  inputMode: "numeric",
                  value: proposalForm.hostWantedCount,
                  onChange: (event) => updateProposalField("hostWantedCount", event.target.value),
                  placeholder: "1"
                })
              ),
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "締切日時"),
                h("input", {
                  className: "text-input",
                  type: "datetime-local",
                  value: proposalForm.deadlineAt,
                  onChange: (event) => updateProposalField("deadlineAt", event.target.value)
                })
              )
            ),
            h(
              "div",
              { className: "quick-chip-row" },
              h("button", { type: "button", className: "soft-chip", onClick: () => applyQuickDeadline(1) }, "明日締切"),
              h("button", { type: "button", className: "soft-chip", onClick: () => applyQuickDeadline(2) }, "2日後締切"),
              h("button", { type: "button", className: "soft-chip", onClick: () => applyQuickDeadline(7) }, "1週間後")
            )
          ),
          showOptional ? h(
            "section",
            { className: "panel optional-panel" },
            h("span", { className: "micro-label" }, "Optional"),
            h("h2", null, "支払い情報と補足"),
            h(
              "div",
              { className: "field-grid two" },
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "PayPay ID"),
                h("input", {
                  className: "text-input",
                  value: proposalForm.paymentId,
                  onChange: (event) => updateProposalField("paymentId", event.target.value),
                  placeholder: "paypay_user_id"
                })
              ),
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "支払いラベル"),
                h("input", {
                  className: "text-input",
                  value: proposalForm.paymentLabel,
                  onChange: (event) => updateProposalField("paymentLabel", event.target.value),
                  placeholder: "PayPay / 銀行振込"
                })
              )
            ),
            h("label", { className: "field-shell" },
              h("span", { className: "field-label" }, "補足文"),
              h("textarea", {
                className: "text-area",
                rows: 4,
                value: proposalForm.notes,
                onChange: (event) => updateProposalField("notes", event.target.value),
                placeholder: "受け渡し場所や締切補足を入力"
              })
            ),
            h("label", { className: "field-shell" },
              h("span", { className: "field-label" }, "商品URL"),
              h("input", {
                className: "text-input",
                value: proposalForm.productUrl,
                onChange: (event) => updateProposalField("productUrl", event.target.value),
                placeholder: "https://item.rakuten.co.jp/..."
              })
            )
          ) : null,
          h(
            "section",
            { className: "sticky-panel" },
            h(
              "div",
              { className: "submit-summary" },
              h("strong", null, proposalForm.productName || "商品名を入れるとここに表示"),
              h("span", null, unitPrice ? `概算単価 ${unitPrice.toLocaleString("ja-JP")} 円 / 応募導線を自動生成します` : "まずは商品名と金額を入れてください")
            ),
            h("button", { className: "primary-cta", type: "submit", disabled: submitting }, submitting ? "送信中..." : "この内容で募集を作成")
          ),
          renderProposalResult()
        )
      );
    }

    function renderApplyScreen() {
      return h(
        React.Fragment,
        null,
        h(
          "section",
          { className: "hero-card compact" },
          h("span", { className: "eyebrow" }, "Apply LIFF"),
          h("h1", null, "数量だけ決めて、すぐ応募する"),
          h("p", null, "参加者向け画面は案件確認と数量入力だけに絞ります。同じ案件への再応募は自動で上書き更新されます。"),
          renderProfileHeader()
        ),
        renderStatus(),
        h(
          "form",
          { className: "content-stack", onSubmit: handleApplicationSubmit },
          h(
            "section",
            { className: "panel" },
            h(
              "div",
              { className: "panel-head" },
              h(
                "div",
                null,
                h("span", { className: "micro-label" }, "Step 1"),
                h("h2", null, "案件を確認する")
              ),
              h("button", { type: "button", className: "text-button", onClick: refreshSummary }, loadingSummary ? "読込中..." : "再取得")
            ),
            h("label", { className: "field-shell" },
              h("span", { className: "field-label" }, "案件ID"),
              h("input", {
                className: "text-input big",
                value: applyForm.managementId,
                onChange: (event) => updateApplyField("managementId", event.target.value)
              })
            ),
            h(
              "div",
              { className: "summary-panel" },
              h("strong", null, "案件概要"),
              h("p", null, loadingSummary ? "案件情報を読み込んでいます..." : formatProposalSummary(proposalSummary)),
              proposalSummary ? h("div", { className: "quick-chip-row compact" },
                h("span", { className: `soft-chip static-chip ${isCollectingProposal(proposalSummary) ? "" : "is-muted"}` }, isCollectingProposal(proposalSummary) ? "応募受付中" : "受付停止中"),
                proposalSummary.deadlineAt ? h("span", { className: "soft-chip static-chip" }, `締切 ${proposalSummary.deadlineAt}`) : null
              ) : null
            )
          ),
          h(
            "section",
            { className: "panel" },
            h("span", { className: "micro-label" }, "Step 2"),
            h("h2", null, "希望数を決める"),
            h(
              "div",
              { className: "stepper-shell" },
              h("button", {
                type: "button",
                className: "stepper-button",
                onClick: () => updateApplyField("wantedCount", String(Math.max(1, Number(applyForm.wantedCount || 1) - 1)))
              }, "−"),
              h("div", { className: "stepper-value" }, applyForm.wantedCount || "1"),
              h("button", {
                type: "button",
                className: "stepper-button",
                onClick: () => updateApplyField("wantedCount", String(Number(applyForm.wantedCount || 1) + 1))
              }, "+")
            ),
            h("p", { className: "hint" }, "あとで同じ案件に再応募すると、この数量で上書きされます。")
          ),
          h(
            "section",
            { className: "sticky-panel" },
            h(
              "div",
              { className: "submit-summary" },
              h("strong", null, proposalSummary?.productName || "案件を確認してから応募"),
              h("span", null, applyEnabled ? `希望数 ${applyForm.wantedCount || "1"} 個で送信します` : "案件が受付中であることを確認してください")
            ),
            h("button", { className: "primary-cta", type: "submit", disabled: submitting || !applyEnabled }, submitting ? "送信中..." : "この数量で応募する")
          ),
          result ? h(
            "section",
            { className: "panel success-panel" },
            h("span", { className: "micro-label" }, "Saved"),
            h("h2", null, "応募内容を保存しました"),
            h("div", { className: "result-grid" },
              h("div", { className: "result-item" },
                h("span", { className: "field-label" }, "案件ID"),
                h("strong", null, result.managementId || applyForm.managementId)
              ),
              h("div", { className: "result-item" },
                h("span", { className: "field-label" }, "応募数"),
                h("strong", null, `${result.wantedCount || applyForm.wantedCount} 個`)
              )
            )
          ) : null
        )
      );
    }

    if (phase === "booting") {
      return h(
        "main",
        { className: "mobile-app" },
        h(
          "section",
          { className: "hero-card compact" },
          h("span", { className: "eyebrow" }, "Warikan-kun LIFF"),
          h("h1", null, "LINE 連携を初期化しています"),
          h("p", null, "LIFF のログイン状態とプロフィール、保存済み既定値を確認しています。")
        )
      );
    }

    if (phase === "error") {
      return h(
        "main",
        { className: "mobile-app" },
        h(
          "section",
          { className: "hero-card compact" },
          h("span", { className: "eyebrow" }, "Warikan-kun LIFF"),
          h("h1", null, "初期化に失敗しました"),
          h("p", null, "LIFF ID、API Base URL、または LINE アプリ内からの起動導線を確認してください。")
        ),
        renderStatus()
      );
    }

    return h("main", { className: "mobile-app" }, screen === "proposal" ? renderProposalScreen() : renderApplyScreen());
  }

  const rootElement = documentObject.getElementById("app-root");
  if (!rootElement) {
    throw new Error("app-root element was not found.");
  }

  ReactDOM.createRoot(rootElement).render(h(ScreenRoot));
})(window, document);
