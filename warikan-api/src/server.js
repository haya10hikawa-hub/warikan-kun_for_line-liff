"use strict";

const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const {
  createStore,
  bootstrapProfile,
  createProposal,
  postProposal,
  getProposal,
  upsertApplication,
  createPaymentRequest,
  recordPaymentEvent,
  reconcilePayments,
  handleLineWebhook,
  metrics,
  inferProductCount
} = require("./domain");

function createLineMessagingClient(channelAccessToken) {
  if (!channelAccessToken) {
    return null;
  }

  return {
    pushMessage(to, message) {
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({ to, messages: [message] });
        const req = https.request({
          hostname: "api.line.me",
          path: "/v2/bot/message/push",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: `Bearer ${channelAccessToken}`
          }
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ statusCode: res.statusCode, body: text || null });
              return;
            }
            reject(new Error(`LINE push failed: ${res.statusCode} ${text}`.trim()));
          });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });
    }
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function createHtmlFetchClient(timeoutMs = 400) {
  if (typeof fetch !== "function") {
    return null;
  }
  return {
    async fetchHtml(itemUrl) {
      const parsedUrl = new URL(itemUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Only http and https product URLs are supported.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(parsedUrl, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "User-Agent": "warikan-kun-product-inference/1.0",
            Accept: "text/html,application/xhtml+xml"
          }
        });
        if (!response.ok) {
          throw new Error(`HTML fetch failed: ${response.status}`);
        }
        return await response.text();
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

function readResponseTextField(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }
  const chunks = [];
  for (const output of data?.output || []) {
    for (const item of output?.content || []) {
      if (typeof item?.text === "string") {
        chunks.push(item.text);
      }
    }
  }
  return chunks.join("");
}

function createOpenAiClient(apiKey, model = "gpt-5.4-nano", timeoutMs = 1300) {
  if (!apiKey || typeof fetch !== "function") {
    return null;
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      itemCount: { type: ["integer", "null"] },
      unit: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" }
    },
    required: ["itemCount", "unit", "confidence", "reason"]
  };

  return {
    async inferCount(input) {
      const body = JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: "日本語の商品名と安全に抽出された商品ページ情報から、共同購入で分ける商品個数だけを推定してください。容量、重量、価格、割引率は個数に含めません。キャンペーン表現で確定できない場合は itemCount を null にしてください。"
          },
          {
            role: "user",
            content: JSON.stringify({
              itemName: input.itemName,
              itemUrl: input.itemUrl,
              price: input.price,
              shopName: input.shopName,
              safeHtmlText: input.safeHtmlText
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "product_count_inference",
            strict: true,
            schema
          }
        },
        max_output_tokens: 220
      });

      const request = fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body
      }).then(async (response) => {
        const text = await response.text();
        if (!response.ok) {
          throw new Error(`OpenAI inference failed: ${response.status} ${text}`.trim());
        }
        const data = text ? JSON.parse(text) : {};
        const jsonText = readResponseTextField(data);
        if (!jsonText) {
          throw new Error("OpenAI inference returned no JSON text.");
        }
        return JSON.parse(jsonText);
      });

      return withTimeout(request, timeoutMs, "OpenAI inference");
    }
  };
}

const store = createStore({
  publicBaseUrl: process.env.WARIKAN_PUBLIC_BASE_URL,
  defaultPayPayId: process.env.WARIKAN_DEFAULT_PAYPAY_ID,
  defaultPaymentLabel: process.env.WARIKAN_DEFAULT_PAYMENT_LABEL,
  defaultDeadlineHour: process.env.WARIKAN_DEFAULT_DEADLINE_HOUR,
  defaultNotes: process.env.WARIKAN_DEFAULT_NOTES,
  addFriendUrl: process.env.LINE_ADD_FRIEND_URL,
  lineMessagingClient: createLineMessagingClient(process.env.LINE_CHANNEL_ACCESS_TOKEN),
  htmlFetchClient: createHtmlFetchClient(),
  openAiClient: createOpenAiClient(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || "gpt-5.4-nano")
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Line-Signature",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text) {
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || secret === "replace-me") {
    return true;
  }
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  if (Buffer.byteLength(digest) !== Buffer.byteLength(signature || "")) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature || ""));
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/metrics") {
    sendJson(res, 200, metrics(store));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/liff/proposal/")) {
    const managementId = decodeURIComponent(url.pathname.replace("/api/liff/proposal/", ""));
    sendJson(res, 200, getProposal(store, managementId));
    return;
  }

  const rawBody = await readBody(req);
  const body = parseJson(rawBody);

  if (req.method === "POST" && url.pathname === "/api/liff/profile/bootstrap") {
    sendJson(res, 200, bootstrapProfile(store, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/liff/proposal/create") {
    sendJson(res, 201, await createProposal(store, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/liff/products/infer-count") {
    sendJson(res, 200, await inferProductCount(store, body));
    return;
  }

  const proposalPostMatch = url.pathname.match(/^\/api\/liff\/proposal\/([^/]+)\/post$/);
  if (req.method === "POST" && proposalPostMatch) {
    sendJson(res, 200, await postProposal(store, {
      ...body,
      managementId: decodeURIComponent(proposalPostMatch[1])
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/liff/application/upsert") {
    sendJson(res, 200, upsertApplication(store, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/line/webhook") {
    if (!verifyLineSignature(rawBody, req.headers["x-line-signature"])) {
      sendJson(res, 401, { error: "invalid_signature", message: "LINE signature verification failed." });
      return;
    }
    sendJson(res, 200, handleLineWebhook(store, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments/request") {
    sendJson(res, 201, createPaymentRequest(store, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments/webhook") {
    sendJson(res, 202, recordPaymentEvent(store, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments/reconcile") {
    sendJson(res, 200, reconcilePayments(store, body));
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Route was not found." });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    const payload = {
      error: error.code || "internal_error",
      message: error.message || "Internal server error."
    };
    if (error.managementId) {
      payload.managementId = error.managementId;
    }
    if (error.postStatus) {
      payload.postStatus = error.postStatus;
    }
    sendJson(res, error.statusCode || 500, payload);
  });
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => {
  process.stdout.write(`warikan-api listening on http://localhost:${port}\n`);
});
