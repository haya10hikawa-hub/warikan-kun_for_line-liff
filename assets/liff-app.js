(function bootstrapWarikanLiffRuntime(windowObject) {
  const previewProfiles = {
    profile: {
      userId: "U-preview-user",
      displayName: "LIFF Preview User"
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
      wantedCount: "1"
    };
  }

  function createPreviewContext(reason, screen) {
    const liffId = getLiffId(screen);
    return {
      idToken: "preview-id-token",
      profile: previewProfiles.profile,
      bootstrapData: {
        lineUserId: previewProfiles.profile.userId,
        displayName: previewProfiles.profile.displayName,
        defaults: previewProfiles.defaults,
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
        return createPreviewContext("LIFF SDK を読み込めないため、プレビューモードで表示しています。", screen);
      }
      throw new Error("LIFF SDK is not loaded.");
    }

    if (!liffId) {
      if (config.allowExternalPreview) {
        return createPreviewContext("LIFF ID が未設定です。config.js を設定してください。", screen);
      }
      throw new Error("LIFF ID is not configured.");
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

    if (!idToken) {
      throw new Error("ID token could not be acquired from LIFF.");
    }

    let bootstrapData;
    if (windowObject.WarikanApi && config.apiBaseUrl) {
      bootstrapData = await windowObject.WarikanApi.bootstrapProfile(idToken);
    } else {
      bootstrapData = {
        lineUserId: profile.userId,
        displayName: profile.displayName,
        defaults: previewProfiles.defaults,
        available: true,
        preview: true
      };
      status = {
        kind: "warning",
        message: "API Base URL が未設定のため、ローカルプレビュー用の既定値を使っています。"
      };
    }

    return {
      idToken,
      profile,
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
      throw new Error("managementId is required.");
    }

    if (!config.apiBaseUrl) {
      return {
        managementId,
        productName: "プレビュー案件",
        totalPrice: 4800,
        deadlineAt: buildDeadlineValue("21:00", 2),
        notes: "API 接続後に実案件を表示します。"
      };
    }

    return windowObject.WarikanApi.getProposal(managementId);
  }

  async function submitProposal(idToken, proposal) {
    const config = getConfig();
    if (!config.apiBaseUrl) {
      return {
        managementId: `preview-${Date.now()}`,
        proposal,
        mode: "preview"
      };
    }
    return windowObject.WarikanApi.createProposal(idToken, proposal);
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

  windowObject.WarikanLiffRuntime = {
    getConfig,
    getInitialManagementId,
    buildDeadlineValue,
    buildApplyUrl,
    bootstrap,
    loadProposal,
    submitProposal,
    submitApplication,
    searchProducts
  };
})(window);
