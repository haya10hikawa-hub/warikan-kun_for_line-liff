(function attachWarikanApi(windowObject) {
  const defaultHeaders = {
    "Content-Type": "application/json"
  };

  function joinUrl(baseUrl, pathname) {
    const base = (baseUrl || "").replace(/\/+$/, "");
    const path = pathname.replace(/^\/+/, "");
    if (!base) {
      throw new Error("API Base URL is not configured.");
    }
    return `${base}/${path}`;
  }

  async function requestJson(method, pathname, payload) {
    const config = windowObject.WarikanLiffRuntime.getConfig();
    const url = joinUrl(config.apiBaseUrl, pathname);
    const response = await fetch(url, {
      method,
      headers: defaultHeaders,
      body: payload ? JSON.stringify(payload) : undefined
    });

    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(`API response is not JSON: ${text}`);
      }
    }

    if (!response.ok) {
      const message = data?.message || data?.error || response.statusText;
      const error = new Error(message);
      if (data && typeof data === "object") {
        Object.assign(error, data);
      }
      error.statusCode = response.status;
      throw error;
    }

    return data;
  }

  function createIdempotencyKey(prefix) {
    if (windowObject.crypto?.randomUUID) {
      return `${prefix}:${windowObject.crypto.randomUUID()}`;
    }
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  windowObject.WarikanApi = {
    bootstrapProfile(idToken) {
      return requestJson("POST", "/api/liff/profile/bootstrap", {
        idToken,
        idempotencyKey: createIdempotencyKey("profile")
      });
    },
    createProposal(idToken, proposal) {
      return requestJson("POST", "/api/liff/proposal/create", {
        idToken,
        proposal,
        idempotencyKey: createIdempotencyKey("proposal")
      });
    },
    postProposal(idToken, managementId) {
      return requestJson("POST", `/api/liff/proposal/${encodeURIComponent(managementId)}/post`, {
        idToken,
        idempotencyKey: createIdempotencyKey("proposal-post")
      });
    },
    getProposal(managementId) {
      return requestJson("GET", `/api/liff/proposal/${encodeURIComponent(managementId)}`);
    },
    upsertApplication(idToken, managementId, wantedCount) {
      return requestJson("POST", "/api/liff/application/upsert", {
        idToken,
        managementId,
        wantedCount,
        idempotencyKey: createIdempotencyKey("application")
      });
    },
    searchProducts(keyword) {
      return requestJson("GET", `/api/liff/products/search?keyword=${encodeURIComponent(keyword || "")}`);
    },
    inferProductCount(product) {
      return requestJson("POST", "/api/liff/products/infer-count", product);
    }
  };
})(window);
