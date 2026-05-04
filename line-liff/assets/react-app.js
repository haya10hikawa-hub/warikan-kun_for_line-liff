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

  function normalizeWantedCount(value) {
    const count = Number(value || 0);
    if (!Number.isFinite(count) || count < 1) {
      return "1";
    }
    return String(Math.floor(count));
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

  function getStatusLabel(status) {
    if (!status || status === "collecting") {
      return "応募受付中";
    }
    if (status === "closed") {
      return "受付終了";
    }
    return status;
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

  function normalizeProductText(value) {
    return String(value || "")
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/[×＊✕]/g, "×")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferCountFromName(itemName) {
    const text = normalizeProductText(itemName);
    if (!text) {
      return { itemCount: null, autoApply: false, sourceLayer: "none" };
    }
    const countUnit = "(個入り|本入り|枚入り|袋入り|個入|本入|枚入|袋入|パック|セット|ケース|カートン|ロール|枚|本|個|袋|箱|缶|包|巻|食|粒|錠)";
    const campaign = /(買えば|買うと|もう\s*1|おまけ|無料|プレゼント|キャンペーン|増量|実質|ポイント)/;
    let match = new RegExp(`(\\d+)\\s*${countUnit}\\s*×\\s*(\\d+)\\s*${countUnit}`).exec(text);
    if (match) {
      return { itemCount: Number(match[1]) * Number(match[3]), confidence: 0.96, sourceLayer: "regex", autoApply: true };
    }
    match = new RegExp(`(\\d+)\\s*${countUnit}\\s*×\\s*(\\d+)`).exec(text);
    if (match) {
      return { itemCount: Number(match[1]) * Number(match[3]), confidence: 0.94, sourceLayer: "regex", autoApply: true };
    }

    const matches = [];
    const directPattern = new RegExp(`(\\d+)\\s*${countUnit}`, "g");
    while ((match = directPattern.exec(text))) {
      matches.push({ itemCount: Number(match[1]), raw: match[0] });
    }
    if (!matches.length || (campaign.test(text) && matches.length > 1)) {
      return { itemCount: null, confidence: 0, sourceLayer: "none", autoApply: false };
    }
    return { ...matches[matches.length - 1], confidence: 0.92, sourceLayer: "regex", autoApply: true };
  }

  function ScreenRoot() {
    const screen = documentObject.body.dataset.screen || "proposal";
    const [phase, setPhase] = React.useState("booting");
    const [context, setContext] = React.useState(null);
    const [status, setStatus] = React.useState(null);
    const [result, setResult] = React.useState(null);
    const [redirectCountdown, setRedirectCountdown] = React.useState(5);
    const [proposalSummary, setProposalSummary] = React.useState(null);
    const [loadingSummary, setLoadingSummary] = React.useState(false);
    const [showOptional, setShowOptional] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const [searchKeyword, setSearchKeyword] = React.useState("");
    const [searchTouched, setSearchTouched] = React.useState(false);
    const [searchLoading, setSearchLoading] = React.useState(false);
    const [searchError, setSearchError] = React.useState("");
    const [searchResults, setSearchResults] = React.useState([]);
    const [itemCountInference, setItemCountInference] = React.useState({ status: "idle", label: "" });
    const itemCountTouchedRef = React.useRef(false);
    const inferenceRequestRef = React.useRef(0);
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

    React.useEffect(() => {
      if (screen !== "proposal" || !result?.postStatus?.delivered) {
        return undefined;
      }

      let remaining = 5;
      setRedirectCountdown(remaining);
      const timer = windowObject.setInterval(() => {
        remaining -= 1;
        setRedirectCountdown(remaining);
        if (remaining <= 0) {
          windowObject.clearInterval(timer);
          windowObject.WarikanLiffRuntime.closeProposalWindow();
        }
      }, 1000);

      return () => windowObject.clearInterval(timer);
    }, [result?.managementId, result?.postStatus?.delivered, screen]);

    const unitPrice = calculateUnitPrice(proposalForm.totalPrice, proposalForm.itemCount);
    const hasResolvedManagementId = Boolean(applyForm.managementId);
    const applyEnabled = hasResolvedManagementId && Number(applyForm.wantedCount) > 0 && isCollectingProposal(proposalSummary);
    const applyUnitPrice = calculateUnitPrice(proposalSummary?.totalPrice, proposalSummary?.itemCount);
    const hasProposalGroupContext = screen !== "proposal" || Boolean(context?.preview || context?.lineContext?.groupId || context?.lineContext?.roomId);
    const showRequiredPaymentField = screen === "proposal" && (
      context?.bootstrapData?.profileCompleteness?.hasDefaultPayPayId === false ||
      !String(proposalForm.paymentId || "").trim()
    );

    function appClassName() {
      const screenClass = screen === "proposal" ? "proposal-app" : "apply-app";
      return `mobile-app liff-mobile-app ${screenClass}`;
    }

    function updateProposalField(name, value) {
      if (name === "itemCount") {
        itemCountTouchedRef.current = true;
        setItemCountInference(value ? { status: "manual", label: "手入力を優先" } : { status: "idle", label: "" });
      }
      setProposalForm((current) => ({ ...current, [name]: value }));
      if (name === "productName") {
        setSearchKeyword(value);
        setSearchTouched(false);
        setSearchError("");
        setSearchResults([]);
        if (!itemCountTouchedRef.current) {
          setItemCountInference({ status: "idle", label: "" });
        }
      }
    }

    function updateApplyField(name, value) {
      setApplyForm((current) => ({ ...current, [name]: value }));
    }

    function adjustWantedCount(delta) {
      setApplyForm((current) => ({
        ...current,
        wantedCount: normalizeWantedCount(Number(current.wantedCount || 1) + delta)
      }));
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
      setSearchTouched(true);
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

    async function applySearchItem(item) {
      setProposalForm((current) => ({
        ...current,
        productName: item.itemName || current.productName,
        productUrl: item.itemUrl || current.productUrl,
        totalPrice: item.price ? String(item.price) : current.totalPrice
      }));
      setStatus({ kind: "success", message: "商品候補をフォームへ反映しました。" });
      setSearchTouched(false);
      setSearchError("");
      setSearchResults([]);

      if (itemCountTouchedRef.current) {
        setItemCountInference({ status: "manual", label: "手入力を優先" });
        return;
      }

      const local = inferCountFromName(item.itemName);
      if (local.autoApply && local.itemCount) {
        setProposalForm((current) => ({ ...current, itemCount: String(local.itemCount) }));
        setItemCountInference({ status: "done", label: "自動入力済み" });
        return;
      }

      const requestId = inferenceRequestRef.current + 1;
      inferenceRequestRef.current = requestId;
      setItemCountInference({ status: "loading", label: "解析中" });
      const aiTimer = windowObject.setTimeout(() => {
        if (inferenceRequestRef.current === requestId && !itemCountTouchedRef.current) {
          setItemCountInference({ status: "ai", label: "AI解析中" });
        }
      }, 400);

      try {
        const inferred = await windowObject.WarikanLiffRuntime.inferProductCount({
          itemName: item.itemName || "",
          itemUrl: item.itemUrl || "",
          price: item.price || 0,
          shopName: item.shopName || ""
        });
        if (inferenceRequestRef.current !== requestId) {
          return;
        }
        if (inferred?.autoApply && inferred.itemCount && !itemCountTouchedRef.current) {
          setProposalForm((current) => ({ ...current, itemCount: String(inferred.itemCount) }));
          setItemCountInference({ status: "done", label: "自動入力済み" });
          return;
        }
        setItemCountInference({ status: "manual", label: "手入力してください" });
      } catch (_error) {
        if (inferenceRequestRef.current === requestId && !itemCountTouchedRef.current) {
          setItemCountInference({ status: "manual", label: "手入力してください" });
        }
      } finally {
        windowObject.clearTimeout(aiTimer);
      }
    }

    async function handleProposalSubmit(event) {
      event.preventDefault();
      if (!proposalForm.productName || !proposalForm.deadlineAt || Number(proposalForm.totalPrice) <= 0 || Number(proposalForm.itemCount) <= 0 || Number(proposalForm.hostWantedCount) <= 0) {
        setStatus({ kind: "error", message: "商品名、合計金額、商品個数、希望個数、締切を入力してください。" });
        return;
      }
      if (!String(proposalForm.paymentId || "").trim()) {
        setStatus({ kind: "error", message: "PayPay IDを入力してください。" });
        setShowOptional(true);
        return;
      }

      try {
        setSubmitting(true);
        setStatus(null);
        setResult(null);
        const response = await windowObject.WarikanLiffRuntime.submitProposal(context.idToken, {
          ...proposalForm,
          groupId: context?.lineContext?.groupId || context?.lineContext?.roomId || "",
          totalPrice: Number(proposalForm.totalPrice),
          itemCount: Number(proposalForm.itemCount),
          hostWantedCount: Number(proposalForm.hostWantedCount || 0)
        });
        setResult(response);
        if (!response?.postStatus?.delivered) {
          setResult({
            ...response,
            error: "グループへの自動投稿に失敗しました。もう一度試してください。"
          });
        }
      } catch (error) {
        if ((error.error || error.code) === "payment_id_required") {
          setStatus({ kind: "error", message: "PayPay IDを入力してください。" });
          setShowOptional(true);
          setResult(null);
          return;
        }
        setStatus(null);
        setResult({
          error: error.message,
          code: error.error || error.code,
          managementId: error.managementId,
          postStatus: error.postStatus || {
            attempted: Boolean(error.managementId),
            delivered: false
          }
        });
      } finally {
        setSubmitting(false);
      }
    }

    async function handleProposalRetry() {
      if (!result?.managementId) {
        setStatus({ kind: "error", message: "LINEグループ内から開き直してください。" });
        return;
      }

      try {
        setSubmitting(true);
        setStatus(null);
        const response = await windowObject.WarikanLiffRuntime.postProposal(context.idToken, result.managementId);
        setResult(response);
      } catch (error) {
        setStatus(null);
        setResult((current) => ({
          ...current,
          error: error.message,
          code: error.error || error.code,
          managementId: error.managementId || current?.managementId,
          postStatus: error.postStatus || current?.postStatus || {
            attempted: true,
            delivered: false
          }
        }));
      } finally {
        setSubmitting(false);
      }
    }

    async function handleApplicationSubmit(event) {
      event.preventDefault();
      if (!hasResolvedManagementId || Number(applyForm.wantedCount) <= 0) {
        setStatus({ kind: "error", message: "募集リンクから開き直して、数量だけ決めて応募してください。" });
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
      if (!hasResolvedManagementId) {
        setStatus({ kind: "error", message: "募集リンクに案件情報が含まれていません。グループの提案メッセージから開いてください。" });
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

    function renderStatus() {
      if (!status) {
        return null;
      }
      return h(
        "div",
        { className: `notice is-${status.kind || "info"}` },
        h("strong", null, status.kind === "error" ? "確認してください" : "お知らせ"),
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
          h("span", { className: "micro-label" }, "LINEアカウント"),
          h("strong", null, context?.profile?.displayName || "未取得"),
          h("span", { className: "micro-copy" }, context?.profile?.userId || context?.bootstrapData?.lineUserId || "preview")
        ),
        h(
          "div",
          { className: "profile-badges" },
          h("span", { className: "status-pill" }, context?.preview ? "Preview" : "Connected"),
          h("span", { className: "status-pill secondary" }, context?.isInClient ? "LINE内" : "外部ブラウザ"),
          context?.lineContext?.groupId ? h("span", { className: "status-pill secondary" }, "グループ起動") : null
        )
      );
    }

    function renderScreenHeader(options) {
      return h(
        "section",
        { className: `screen-header ${options.tone || ""}`.trim() },
        h(
          "div",
          { className: "screen-header-main" },
          h("img", {
            className: "screen-logo",
            src: "./assets/warikan-kun-logo.png",
            alt: "割り勘くん ロゴ"
          }),
          h(
            "div",
            { className: "screen-copy" },
            h("span", { className: "screen-label" }, options.kicker),
            h("h1", null, options.title),
            h("p", null, options.body)
          )
        ),
        h(
          "div",
          { className: "screen-chip-row" },
          options.stats.map((item) => h("span", { key: item, className: "screen-chip" }, item))
        ),
        renderProfileHeader()
      );
    }

    function renderBrandHero(options) {
      return h(
        "section",
        { className: "brand-hero" },
        h(
          "div",
          { className: "brand-hero-main" },
          h(
            "div",
            { className: "brand-mark-wrap" },
            h("img", {
              className: "brand-mark",
              src: "./assets/warikan-kun-logo.png",
              alt: "割り勘くん ロゴ"
            })
          ),
          h(
            "div",
            { className: "brand-copy" },
            h("span", { className: "brand-kicker" }, options.kicker),
            h("h1", null, options.title),
            h("p", null, options.body)
          )
        ),
        h(
          "div",
          { className: "brand-stats" },
          options.stats.map((item) => h("span", { key: item, className: "brand-chip" }, item))
        ),
        renderProfileHeader()
      );
    }

    function renderProposalResult() {
      if (!result) {
        return null;
      }

      if (result.postStatus?.delivered) {
        return h(
          "section",
          { className: "panel success-panel proposal-outcome redirect-panel" },
          h("span", { className: "micro-label" }, "投稿完了"),
          h("div", { className: "redirect-hero" },
            h("div", { className: "redirect-countdown", "aria-label": `あと${redirectCountdown}秒でLINEに戻ります` },
              h("span", { className: "redirect-number" }, redirectCountdown),
              h("span", { className: "redirect-unit" }, "秒")
            ),
            h("h2", null, "LINEに戻ります"),
            h("p", null, "募集はグループに投稿済み")
          ),
          h("strong", { className: "posted-product" }, proposalForm.productName || result.proposal?.productName || "募集"),
          h("p", { className: "redirect-copy" }, "そのままお待ちください")
        );
      }

      return h(
        "section",
        { className: "panel failure-panel proposal-outcome" },
        h("span", { className: "micro-label" }, "投稿未完了"),
        h("h2", null, "投稿できませんでした"),
        h("p", { className: "section-copy visible-copy" }, result.error || "グループへの自動投稿に失敗しました。もう一度試してください。"),
        result.code === "group_context_required" || !result.managementId ? h(
          "p",
          { className: "hint" },
          "LINEグループ内の作成画面から開き直してください。"
        ) : h(
          "button",
          {
            type: "button",
            className: "primary-button",
            onClick: handleProposalRetry,
            disabled: submitting
          },
          submitting ? "再投稿中..." : "再試行"
        ),
        result.managementId ? h("p", { className: "micro-copy result-footnote" }, "募集内容は保存されています。再試行で同じ募集を投稿します。") : null
      );
    }

    function renderSearchIcon() {
      return h(
        "svg",
        {
          className: "search-icon",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true"
        },
        h("circle", { cx: "11", cy: "11", r: "7" }),
        h("path", { d: "m20 20-3.5-3.5" })
      );
    }

    function renderInlineSearchResults() {
      if (!searchTouched && !searchLoading && !searchError && !searchResults.length) {
        return null;
      }

      return h(
        "div",
        { className: "search-shell inline-search-results" },
        searchLoading ? h("div", { className: "search-loading", "aria-live": "polite" }) : null,
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
            h("strong", null, item.itemName || "商品名なし"),
            h("span", { className: "search-meta" }, `${item.shopName || "ショップ名なし"} / ${formatYen(item.price)}`))
          )
        ) : null
      );
    }

    function renderProposalScreen() {
      const proposalDelivered = Boolean(result?.postStatus?.delivered);
      if (!proposalDelivered && !hasProposalGroupContext) {
        return h(
          React.Fragment,
          null,
          renderScreenHeader({
            kicker: "募集作成",
            title: "LINEグループから開いてください",
            body: "募集は投稿先のグループ内で開始します。",
            stats: ["グループ起動", "自動投稿"],
            tone: "is-proposal"
          }),
          renderStatus(),
          h(
            "section",
            { className: "panel missing-link-panel" },
            h("span", { className: "micro-label" }, "起動場所"),
            h("h2", null, "グループで開き直してください"),
            h("p", { className: "section-copy visible-copy" }, "投稿したいLINEグループから募集画面を開いてください。")
          )
        );
      }

      return h(
        React.Fragment,
        null,
        proposalDelivered ? null : renderScreenHeader({
          kicker: "募集作成",
          title: "募集を開始する",
          body: "必要な項目だけ入力してグループ募集を始めます。",
          stats: ["2ステップ", "すぐ作成", "支払いは個別"],
          tone: "is-proposal"
        }),
        renderStatus(),
        result ? renderProposalResult() : null,
        result ? null :
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
                h("span", { className: "micro-label" }, "1"),
                h("h2", null, "商品を決める")
              )
            ),
            h("div", { className: "field-shell" },
              h("span", { className: "field-label" }, "商品名"),
              h("div", { className: "product-search-field" },
                h("input", {
                  className: "text-input big",
                  value: proposalForm.productName,
                  onChange: (event) => updateProposalField("productName", event.target.value),
                  placeholder: "例: コカ・コーラ 500ml 24本"
                }),
                h("button", {
                  type: "button",
                  className: "search-icon-button",
                  onClick: handleProductSearch,
                  disabled: searchLoading,
                  "aria-label": "商品を検索"
                }, renderSearchIcon())
              ),
              renderInlineSearchResults()
            ),
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
                h("span", { className: "field-label-row" },
                  h("span", { className: "field-label" }, "商品個数"),
                  itemCountInference.label ? h("span", { className: `field-status is-${itemCountInference.status}` }, itemCountInference.label) : null
                ),
                h("input", {
                  className: "text-input",
                  inputMode: "numeric",
                  value: proposalForm.itemCount,
                  onChange: (event) => updateProposalField("itemCount", event.target.value),
                  placeholder: "24"
                })
              ),
              h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "希望個数"),
                h("input", {
                  className: "text-input",
                  inputMode: "numeric",
                  value: proposalForm.hostWantedCount,
                  onChange: (event) => updateProposalField("hostWantedCount", event.target.value),
                  placeholder: "1"
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
                h("span", { className: "micro-label" }, "2"),
                h("h2", null, "募集条件を決める")
              ),
              h("button", {
                type: "button",
                className: "text-button",
                onClick: () => setShowOptional((current) => !current)
              }, showOptional ? "閉じる" : "詳細")
            ),
            h(
              "div",
              { className: "field-grid" },
              showRequiredPaymentField ? h("label", { className: "field-shell" },
                h("span", { className: "field-label" }, "PayPay ID"),
                h("input", {
                  className: "text-input",
                  value: proposalForm.paymentId,
                  onChange: (event) => updateProposalField("paymentId", event.target.value),
                  placeholder: "paypay_user_id"
                })
              ) : null,
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
            h("span", { className: "micro-label" }, "詳細"),
            h("h2", null, "支払い先と補足"),
            h("button", { type: "button", className: "text-button optional-default-button", onClick: applyProfileDefaults }, "既定値を反映"),
            h(
              "div",
              { className: "field-grid two" },
              showRequiredPaymentField ? null : h("label", { className: "field-shell" },
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
              h("span", null, unitPrice ? `概算単価 ${unitPrice.toLocaleString("ja-JP")} 円` : "必要項目を入れてください")
            ),
            h("button", { className: "primary-cta", type: "submit", disabled: submitting }, submitting ? "募集を投稿しています" : "募集を開始する")
          )
        )
      );
    }

    function renderApplyScreen() {
      if (!hasResolvedManagementId) {
        return h(
          React.Fragment,
          null,
          renderScreenHeader({
            kicker: "応募",
            title: "募集リンクから開いてください",
            body: "LINEグループの応募リンクから開き直してください。",
            stats: ["リンク起動", "数量だけ"],
            tone: "is-apply"
          }),
          renderStatus(),
          h(
            "section",
            { className: "panel missing-link-panel" },
            h("span", { className: "micro-label" }, "リンクが必要です"),
            h("h2", null, "募集が見つかりません"),
            h("p", { className: "section-copy visible-copy" }, "LINEグループの応募リンクから開き直してください。"),
            h(
              "div",
              { className: "quick-chip-row" },
              h("a", { className: "soft-chip", href: "./proposal.html" }, "主催者側の作成画面を見る"),
              h("span", { className: "soft-chip static-chip is-muted" }, "応募は募集リンクからのみ")
            )
          )
        );
      }

      return h(
        React.Fragment,
        null,
        renderScreenHeader({
          kicker: "数量変更",
          title: "その他数量・再編集",
          body: "1〜3個以外の数だけ保存します。",
          stats: ["数量だけ", "再応募で更新"],
          tone: "is-apply"
        }),
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
                h("span", { className: "micro-label" }, "内容"),
                h("h2", null, "募集内容")
              ),
              h("button", { type: "button", className: "text-button", onClick: refreshSummary }, loadingSummary ? "読込中..." : "更新")
            ),
            h(
              "div",
              { className: "summary-panel summary-card" },
              loadingSummary ? h("p", null, "案件情報を読み込んでいます...") : proposalSummary ? h(
                React.Fragment,
                null,
                h("strong", { className: "summary-title" }, proposalSummary.productName || "商品名未設定"),
                h("div", { className: "summary-metrics" },
                  h("div", { className: "summary-metric" },
                    h("span", { className: "field-label" }, "合計金額"),
                    h("strong", null, formatYen(proposalSummary.totalPrice))
                  ),
                  h("div", { className: "summary-metric" },
                    h("span", { className: "field-label" }, "商品個数"),
                    h("strong", null, proposalSummary.itemCount || "-")
                  ),
                  h("div", { className: "summary-metric accent" },
                    h("span", { className: "field-label" }, "希望単価"),
                    h("strong", null, applyUnitPrice ? `${applyUnitPrice.toLocaleString("ja-JP")}円` : "-")
                  ),
                  h("div", { className: "summary-metric" },
                    h("span", { className: "field-label" }, "締切"),
                    h("strong", null, proposalSummary.deadlineAt || "-")
                  )
                ),
                h("div", { className: "quick-chip-row compact" },
                  h("span", { className: `soft-chip static-chip ${isCollectingProposal(proposalSummary) ? "" : "is-muted"}` }, getStatusLabel(proposalSummary.status)),
                  h("span", { className: "soft-chip static-chip" }, "再応募で更新")
                ),
                proposalSummary.notes ? h("p", { className: "hint" }, proposalSummary.notes) : null
              ) : h("p", null, formatProposalSummary(proposalSummary))
            )
          ),
          h(
            "section",
            { className: "panel quantity-panel" },
            h("span", { className: "micro-label" }, "数量"),
            h("h2", null, "欲しい数を保存する"),
            h(
              "div",
              { className: "quantity-input-row" },
              h("button", {
                type: "button",
                className: "count-button",
                onClick: () => adjustWantedCount(-1)
              }, "-"),
              h("label", { className: "field-shell quantity-number-field" },
                h("span", { className: "field-label" }, "希望数"),
                h("input", {
                  className: "text-input big quantity-number-input",
                  inputMode: "numeric",
                  value: applyForm.wantedCount,
                  onChange: (event) => updateApplyField("wantedCount", normalizeWantedCount(event.target.value)),
                  placeholder: "4"
                })
              ),
              h("button", {
                type: "button",
                className: "count-button",
                onClick: () => adjustWantedCount(1)
              }, "+")
            ),
            h("p", { className: "hint" }, "支払い案内は個別に届きます。")
          ),
          h(
            "section",
            { className: "sticky-panel" },
            h(
              "div",
              { className: "submit-summary" },
              h("strong", null, proposalSummary?.productName || "募集を確認してから応募"),
              h("span", null, applyEnabled ? `希望数 ${applyForm.wantedCount || "1"} 個で保存します` : "受付状態を確認してください"),
              proposalSummary?.deadlineAt ? h("span", { className: "deadline-copy" }, `締切 ${proposalSummary.deadlineAt}`) : null
            ),
            h("button", { className: "primary-cta", type: "submit", disabled: submitting || !applyEnabled }, submitting ? "送信中..." : "この数で保存")
          ),
          result ? h(
            "section",
            { className: "panel success-panel" },
            h("span", { className: "micro-label" }, "保存完了"),
            h("h2", null, "応募内容を保存しました"),
            h("div", { className: "result-grid" },
              h("div", { className: "result-item" },
                h("span", { className: "field-label" }, "商品名"),
                h("strong", null, proposalSummary?.productName || "案件")
              ),
              h("div", { className: "result-item" },
                h("span", { className: "field-label" }, "応募数"),
                h("strong", null, `${result.wantedCount || applyForm.wantedCount} 個`)
              )
            ),
            h("div", { className: "handoff-panel" },
              h("strong", null, "次の案内は個別に届きます"),
              h("p", null, result.friendRequired || result.dmReachable === false ? "友だち追加がまだの場合は、グループの案内から追加してください。" : "支払い案内、証跡提出、完了通知は個別に送られます。")
            )
          ) : null
        )
      );
    }

    if (phase === "booting") {
      return h(
        "main",
        { className: appClassName() },
        renderBrandHero({
          kicker: "準備中",
          title: "LINEとつないでいます",
          body: "ログイン状態と保存済みの設定を確認しています。",
          stats: ["接続確認中", "プロフィール読込", "設定同期"]
        })
      );
    }

    if (phase === "error") {
      return h(
        "main",
        { className: appClassName() },
        renderBrandHero({
          kicker: "確認してください",
          title: "初期化に失敗しました",
          body: "LINEアプリ内から開いているか、設定が正しいか確認してください。",
          stats: ["設定確認", "LINE接続", "保存先確認"]
        }),
        renderStatus()
      );
    }

    return h("main", { className: appClassName() }, screen === "proposal" ? renderProposalScreen() : renderApplyScreen());
  }

  const rootElement = documentObject.getElementById("app-root");
  if (!rootElement) {
    throw new Error("app-root element was not found.");
  }

  ReactDOM.createRoot(rootElement).render(h(ScreenRoot));
})(window, document);
