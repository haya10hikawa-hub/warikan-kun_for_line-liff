(function bootstrapWarikanLiffRuntime(windowObject) {
  const previewProfiles = {
    profile: {
      userId: "U-preview-user",
      displayName: "プレビュー利用者"
    },
    defaults: {
      defaultPayPayId: "preview-paypay",
      defaultPaymentLabel: "PayPay",
      defaultDeadlineHour: "21:00",
      defaultNotes: "学内受け渡し予定です。"
    }
  };

  function getStoredOverride(storageKey) {
    try {
      const raw = windowObject.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function getConfig() {
    const baseConfig = windowObject.WARIKAN_LIFF_CONFIG || {};
    const override = getStoredOverride(baseConfig.storageKey || "warikan-kun:liff:config");
    return { ...baseConfig, ...override };
  }

  function getLiffId(screen) {
    const config = getConfig();
    return screen === "proposal" ? config.proposalLiffId : config.applyLiffId;
  }

  function getInitialManagementId() {
    const params = new URLSearchParams(windowObject.location.search);
    return params.get("managementId") || "";
  }

  function getInitialWantedCount() {
    const params = new URLSearchParams(windowObject.location.search);
    if (params.get("mode") === "other") {
      return "4";
    }
    return params.get("wantedCount") || "1";
  }

  function buildDeadlineValue(defaultHour, daysOffset) {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysOffset);
    const [hour, minute] = (defaultHour || "21:00").split(":");
    deadline.setHours(Number(hour || 21), Number(minute || 0), 0, 0);

    const year = deadline.getFullYear();
    const month = String(deadline.getMonth() + 1).padStart(2, "0");
    const date = String(deadline.getDate()).padStart(2, "0");
    const hours = String(deadline.getHours()).padStart(2, "0");
    const minutes = String(deadline.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${date}T${hours}:${minutes}`;
  }

  function buildApplyUrl(managementId) {
    const config = getConfig();
    const baseUrl = config.publicBaseUrl || windowObject.location.origin + windowObject.location.pathname.replace(/\/[^/]*$/, "");
    const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
    return `${normalizedBaseUrl}/apply.html?managementId=${encodeURIComponent(managementId)}`;
  }

  function normalizeProductText(value) {
    return String(value || "")
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/[×＊✕]/g, "×")
      .replace(/\s+/g, " ")
      .trim();
  }

  function previewInferCountFromName(itemName) {
    const text = normalizeProductText(itemName);
    const countUnit = "(個入り|本入り|枚入り|袋入り|個入|本入|枚入|袋入|パック|セット|ケース|カートン|ロール|枚|本|個|袋|箱|缶|包|巻|食|粒|錠)";
    const campaign = /(買えば|買うと|もう\s*1|おまけ|無料|プレゼント|キャンペーン|増量|実質|ポイント)/;
    let match = new RegExp(`(\\d+)\\s*${countUnit}\\s*×\\s*(\\d+)\\s*${countUnit}`).exec(text);
    if (match) {
      return {
        itemCount: Number(match[1]) * Number(match[3]),
        unit: match[2],
        confidence: 0.96,
        sourceLayer: "regex",
        reason: `${match[0]} から推定`,
        autoApply: true
      };
    }
    match = new RegExp(`(\\d+)\\s*${countUnit}\\s*×\\s*(\\d+)`).exec(text);
    if (match) {
      return {
        itemCount: Number(match[1]) * Number(match[3]),
        unit: match[2],
        confidence: 0.94,
        sourceLayer: "regex",
        reason: `${match[0]} から推定`,
        autoApply: true
      };
    }
    const directPattern = new RegExp(`(\\d+)\\s*${countUnit}`, "g");
    const matches = [];
    while ((match = directPattern.exec(text))) {
      matches.push({ itemCount: Number(match[1]), unit: match[2], raw: match[0] });
    }
    if (!matches.length || (campaign.test(text) && matches.length > 1)) {
      return { itemCount: null, unit: "", confidence: 0, sourceLayer: "none", reason: "手入力してください", autoApply: false };
    }
    const selected = matches[matches.length - 1];
    return {
      itemCount: selected.itemCount,
      unit: selected.unit,
      confidence: 0.92,
      sourceLayer: "regex",
      reason: `${selected.raw} から推定`,
      autoApply: true
    };
  }

  function createProposalPrefill(defaults) {
    return {
      productName: "",
      productUrl: "",
      totalPrice: "",
      itemCount: "",
      hostWantedCount: "1",
      deadlineAt: buildDeadlineValue(defaults?.defaultDeadlineHour, 2),
      paymentId: defaults?.defaultPayPayId || "",
      paymentLabel: defaults?.defaultPaymentLabel || "PayPay",
      notes: defaults?.defaultNotes || ""
    };
  }

  function createApplyPrefill() {
    return {
      managementId: getInitialManagementId(),
      wantedCount: getInitialWantedCount()
    };
  }

  function createPreviewContext(reason, screen) {
    const liffId = getLiffId(screen);
    return {
      idToken: "preview-id-token",
      profile: previewProfiles.profile,
      lineContext: {
        type: screen === "proposal" ? "group" : "utou",
        groupId: screen === "proposal" ? "C-preview-group" : ""
      },
      bootstrapData: {
        lineUserId: previewProfiles.profile.userId,
        displayName: previewProfiles.profile.displayName,
        defaults: previewProfiles.defaults,
        isFirstUse: false,
        profileCompleteness: {
          hasDefaultPayPayId: Boolean(previewProfiles.defaults.defaultPayPayId)
        },
        available: true,
        preview: true
      },
      preview: true,
      isInClient: false,
      loginState: liffId ? "preview" : "missing-liff-id",
      status: {
        kind: liffId ? "warning" : "error",
        message: reason
      }
    };
  }

  async function initLiffContext(screen) {
    const config = getConfig();
    const liffId = getLiffId(screen);

    if (typeof windowObject.liff === "undefined") {
      if (config.allowExternalPreview) {
        return createPreviewContext("アプリ起動情報を読み込めないため、プレビューモードで表示しています。", screen);
      }
      throw new Error("アプリ起動情報を読み込めませんでした。LINEアプリ内から開き直してください。");
    }

    if (!liffId) {
      if (config.allowExternalPreview) {
        return createPreviewContext("起動設定が未設定です。config.js を設定してください。", screen);
      }
      throw new Error("起動設定が未設定です。config.js を設定してください。");
    }

    await windowObject.liff.init({ liffId });

    const isInClient = windowObject.liff.isInClient();
    let status = null;
    if (!isInClient) {
      status = {
        kind: "warning",
        message: "LINE 外ブラウザで開いています。最終確認は LINE アプリ内で行ってください。"
      };
    }

    if (!windowObject.liff.isLoggedIn()) {
      windowObject.liff.login({ redirectUri: windowObject.location.href });
      return { redirecting: true };
    }

    const profile = await windowObject.liff.getProfile();
    const idToken = windowObject.liff.getIDToken();
    const lineContext = typeof windowObject.liff.getContext === "function" ? windowObject.liff.getContext() : null;

    if (!idToken) {
      throw new Error("認証情報を取得できませんでした。LINEアプリ内から開き直してください。");
    }

    let bootstrapData;
    if (windowObject.WarikanApi && config.apiBaseUrl) {
      bootstrapData = await windowObject.WarikanApi.bootstrapProfile(idToken);
    } else {
      bootstrapData = {
        lineUserId: profile.userId,
        displayName: profile.displayName,
        defaults: previewProfiles.defaults,
        isFirstUse: false,
        profileCompleteness: {
          hasDefaultPayPayId: Boolean(previewProfiles.defaults.defaultPayPayId)
        },
        available: true,
        preview: true
      };
      status = {
        kind: "warning",
        message: "接続先が未設定のため、ローカルプレビュー用の既定値を使っています。"
      };
    }

    return {
      idToken,
      profile,
      lineContext,
      bootstrapData,
      preview: !config.apiBaseUrl,
      isInClient,
      loginState: "logged-in",
      status
    };
  }

  async function bootstrap(screen) {
    const context = await initLiffContext(screen);
    if (!context || context.redirecting) {
      return context;
    }

    return {
      ...context,
      config: getConfig(),
      initialProposal: createProposalPrefill(context.bootstrapData?.defaults || previewProfiles.defaults),
      initialApply: createApplyPrefill()
    };
  }

  async function loadProposal(managementId) {
    const config = getConfig();
    if (!managementId) {
      throw new Error("募集リンクから開き直してください。");
    }

    if (!config.apiBaseUrl) {
      return {
        managementId,
        productName: "プレビュー案件",
        totalPrice: 4800,
        itemCount: 24,
        deadlineAt: buildDeadlineValue("21:00", 2),
        status: "collecting",
        notes: "接続後に実案件を表示します。"
      };
    }

    return windowObject.WarikanApi.getProposal(managementId);
  }

  async function submitProposal(idToken, proposal) {
    const config = getConfig();
    if (!config.apiBaseUrl) {
      const managementId = `preview-${Date.now()}`;
      return {
        managementId,
        applyUrl: buildApplyUrl(managementId),
        status: "collecting",
        proposal,
        postStatus: {
          attempted: true,
          delivered: true,
          targetGroupId: proposal.groupId || "C-preview-group"
        },
        mode: "preview"
      };
    }
    return windowObject.WarikanApi.createProposal(idToken, proposal);
  }

  async function postProposal(idToken, managementId) {
    const config = getConfig();
    if (!config.apiBaseUrl) {
      return {
        managementId,
        applyUrl: buildApplyUrl(managementId),
        status: "collecting",
        postStatus: {
          attempted: true,
          delivered: true,
          targetGroupId: "C-preview-group"
        },
        mode: "preview"
      };
    }
    return windowObject.WarikanApi.postProposal(idToken, managementId);
  }

  function closeProposalWindow() {
    if (
      windowObject.liff &&
      typeof windowObject.liff.closeWindow === "function" &&
      (!windowObject.liff.isInClient || windowObject.liff.isInClient())
    ) {
      windowObject.liff.closeWindow();
      return;
    }
    windowObject.location.href = "./proposal.html";
  }

  async function submitApplication(idToken, managementId, wantedCount) {
    const config = getConfig();
    if (!config.apiBaseUrl) {
      return {
        applicantManagementId: `${managementId}-preview`,
        managementId,
        wantedCount,
        mode: "preview"
      };
    }
    return windowObject.WarikanApi.upsertApplication(idToken, managementId, wantedCount);
  }

  async function searchProducts(keyword) {
    const config = getConfig();
    const normalizedKeyword = String(keyword || "").trim();
    if (!normalizedKeyword) {
      return { items: [] };
    }

    if (!config.apiBaseUrl || !config.rakutenSearchEnabled) {
      return {
        mode: "preview",
        items: [
          {
            itemName: `${normalizedKeyword} サンプル 24本`,
            itemUrl: "https://example.com/rakuten-preview-item",
            price: 4980,
            shopName: "Warikan Preview Store",
            imageUrl: "",
            platform: "rakuten"
          },
          {
            itemName: `${normalizedKeyword} まとめ買いセット`,
            itemUrl: "https://example.com/rakuten-preview-item-2",
            price: 5280,
            shopName: "Preview Official Shop",
            imageUrl: "",
            platform: "rakuten"
          }
        ]
      };
    }

    return windowObject.WarikanApi.searchProducts(normalizedKeyword);
  }

  async function inferProductCount(product) {
    const local = previewInferCountFromName(product?.itemName);
    const config = getConfig();
    if (!config.apiBaseUrl) {
      return local;
    }
    return windowObject.WarikanApi.inferProductCount(product);
  }

  windowObject.WarikanLiffRuntime = {
    getConfig,
    getInitialManagementId,
    buildDeadlineValue,
    buildApplyUrl,
    bootstrap,
    loadProposal,
    submitProposal,
    postProposal,
    submitApplication,
    searchProducts,
    inferProductCount,
    closeProposalWindow
  };
})(window);
