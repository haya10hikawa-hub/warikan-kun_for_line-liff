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
      throw new Error(`${response.status} ${message}`);
    }

    return data;
  }

  windowObject.WarikanApi = {
    bootstrapProfile(idToken) {
      return requestJson("POST", "/api/liff/profile/bootstrap", { idToken });
    },
    createProposal(idToken, proposal) {
      return requestJson("POST", "/api/liff/proposal/create", { idToken, proposal });
    },
    getProposal(managementId) {
      return requestJson("GET", `/api/liff/proposal/${encodeURIComponent(managementId)}`);
    },
    upsertApplication(idToken, managementId, wantedCount) {
      return requestJson("POST", "/api/liff/application/upsert", {
        idToken,
        managementId,
        wantedCount
      });
    },
    searchProducts(keyword) {
      return requestJson("GET", `/api/liff/products/search?keyword=${encodeURIComponent(keyword || "")}`);
    }
  };
})(window);
