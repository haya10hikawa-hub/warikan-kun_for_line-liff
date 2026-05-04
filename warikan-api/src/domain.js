"use strict";

const { inferProductCount } = require("./product-inference");

const DEFAULTS = {
  publicBaseUrl: "https://your-pages-domain.example.com/line-liff",
  defaultPayPayId: "",
  defaultPaymentLabel: "PayPay",
  defaultDeadlineHour: "21:00",
  defaultNotes: "学内受け渡し予定です。",
  addFriendUrl: "https://lin.ee/replace-me"
};

function createStore(options = {}) {
  const { lineMessagingClient, htmlFetchClient, openAiClient, ...configOptions } = options;
  const config = { ...DEFAULTS };
  for (const [key, value] of Object.entries(configOptions)) {
    if (value !== undefined && value !== null && value !== "") {
      config[key] = value;
    }
  }
  return {
    config,
    seq: 0,
    idempotency: new Map(),
    users: new Map(),
    groups: new Map(),
    proposals: new Map(),
    applications: new Map(),
    orders: new Map(),
    payments: new Map(),
    paymentEvents: [],
    notifications: [],
    auditLogs: [],
    events: [],
    productInferenceCache: new Map(),
    lineMessagingClient: lineMessagingClient || null,
    htmlFetchClient: htmlFetchClient || null,
    openAiClient: openAiClient || null
  };
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function asPositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw httpError(400, `${fieldName} must be a positive integer.`);
  }
  return number;
}

function requireString(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw httpError(400, `${fieldName} is required.`);
  }
  return normalized;
}

function httpError(statusCode, message, code = "bad_request") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function requireIdempotencyKey(key) {
  return requireString(key, "idempotencyKey");
}

function withIdempotency(store, key, operation, handler) {
  const normalizedKey = requireIdempotencyKey(key);
  const existing = store.idempotency.get(normalizedKey);
  if (existing) {
    if (existing.operation !== operation) {
      throw httpError(409, "idempotencyKey was already used for another operation.", "idempotency_conflict");
    }
    return { ...existing.response, idempotentReplay: true };
  }

  const response = handler();
  store.idempotency.set(normalizedKey, {
    operation,
    response,
    createdAt: nowIso()
  });
  return response;
}

function rethrowIdempotentError(existing) {
  const response = existing.response || {};
  const error = httpError(existing.statusCode || 500, response.message || "Request failed.", response.error || "request_failed");
  Object.assign(error, response);
  error.idempotentReplay = true;
  throw error;
}

async function withIdempotencyAsync(store, key, operation, handler) {
  const normalizedKey = requireIdempotencyKey(key);
  const existing = store.idempotency.get(normalizedKey);
  if (existing) {
    if (existing.operation !== operation) {
      throw httpError(409, "idempotencyKey was already used for another operation.", "idempotency_conflict");
    }
    if (existing.failed) {
      rethrowIdempotentError(existing);
    }
    return { ...existing.response, idempotentReplay: true };
  }

  try {
    const response = await handler();
    store.idempotency.set(normalizedKey, {
      operation,
      response,
      createdAt: nowIso()
    });
    return response;
  } catch (error) {
    if (error.idempotentResponse) {
      store.idempotency.set(normalizedKey, {
        operation,
        response: error.idempotentResponse,
        statusCode: error.statusCode,
        failed: true,
        createdAt: nowIso()
      });
    }
    throw error;
  }
}

function lineUserFromToken(idToken) {
  const token = requireString(idToken, "idToken");
  if (token.startsWith("line:")) {
    return token.slice("line:".length);
  }
  if (token === "preview-id-token") {
    return "U-preview-user";
  }
  return `U-${Buffer.from(token).toString("base64url").slice(0, 24)}`;
}

function optionalString(value) {
  return String(value || "").trim();
}

function mergeUserProfile(store, lineUserId, updates = {}, timestamp = nowIso()) {
  const existing = store.users.get(lineUserId) || {};
  const user = {
    lineUserId,
    displayName: updates.displayName || existing.displayName || "LINE User",
    defaultPayPayId: updates.defaultPayPayId !== undefined ? optionalString(updates.defaultPayPayId) : optionalString(existing.defaultPayPayId || store.config.defaultPayPayId),
    defaultPaymentLabel: updates.defaultPaymentLabel || existing.defaultPaymentLabel || store.config.defaultPaymentLabel,
    defaultDeadlineHour: updates.defaultDeadlineHour || existing.defaultDeadlineHour || store.config.defaultDeadlineHour,
    defaultNotes: updates.defaultNotes !== undefined ? String(updates.defaultNotes || "") : String(existing.defaultNotes || store.config.defaultNotes || ""),
    dmReachable: updates.dmReachable !== undefined ? Boolean(updates.dmReachable) : Boolean(existing.dmReachable),
    firstProposalCreatedAt: updates.firstProposalCreatedAt || existing.firstProposalCreatedAt || null,
    firstApplicationAppliedAt: updates.firstApplicationAppliedAt || existing.firstApplicationAppliedAt || null,
    createdAt: existing.createdAt || timestamp,
    updatedAt: timestamp
  };
  store.users.set(lineUserId, user);
  return user;
}

function profileCompleteness(user) {
  return {
    hasDefaultPayPayId: Boolean(optionalString(user.defaultPayPayId))
  };
}

function recordAudit(store, actorLineUserId, action, targetType, targetId, before, after) {
  const audit = {
    auditId: `audit_${store.auditLogs.length + 1}`,
    actorLineUserId,
    action,
    targetType,
    targetId,
    before: before || null,
    after: after || null,
    createdAt: nowIso()
  };
  store.auditLogs.push(audit);
  return audit;
}

function publishEvent(store, type, payload) {
  const event = {
    eventId: `evt_${store.events.length + 1}`,
    type,
    payload,
    status: "pending",
    createdAt: nowIso()
  };
  store.events.push(event);
  return event;
}

function proposalApplyUrl(store, managementId, params = {}) {
  const base = String(store.config.publicBaseUrl || "").replace(/\/+$/, "");
  const searchParams = new URLSearchParams({ managementId, ...params });
  return `${base}/apply.html?${searchParams.toString()}`;
}

function unitPrice(totalPrice, itemCount) {
  return Math.ceil(Number(totalPrice) / Number(itemCount));
}

function buildMessageCard(store, proposal) {
  const applyUrl = proposalApplyUrl(store, proposal.managementId);
  return {
    altText: `共同購入募集: ${proposal.productName}`,
    fields: {
      productName: proposal.productName,
      totalPrice: proposal.totalPrice,
      itemCount: proposal.itemCount,
      unitPrice: unitPrice(proposal.totalPrice, proposal.itemCount),
      deadlineAt: proposal.deadlineAt,
      statusLabel: proposal.status === "collecting" ? "応募受付中" : proposal.status
    },
    primaryAction: {
      label: "欲しい",
      type: "postback",
      data: `action=want&managementId=${encodeURIComponent(proposal.managementId)}`
    },
    fallbackUri: applyUrl
  };
}

function buildLinePushMessage(store, proposal) {
  const messageCard = buildMessageCard(store, proposal);
  const fields = messageCard.fields;
  return {
    type: "flex",
    altText: messageCard.altText,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "共同購入の募集です",
            size: "xs",
            color: "#616061",
            weight: "bold"
          },
          {
            type: "text",
            text: fields.productName,
            size: "lg",
            weight: "bold",
            wrap: true,
            color: "#1d1c1d"
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              { type: "text", text: `合計金額: ${fields.totalPrice.toLocaleString("ja-JP")}円`, size: "sm", color: "#1d1c1d" },
              { type: "text", text: `商品個数: ${fields.itemCount}`, size: "sm", color: "#1d1c1d" },
              { type: "text", text: `希望単価: ${fields.unitPrice.toLocaleString("ja-JP")}円`, size: "sm", color: "#1d1c1d" },
              { type: "text", text: `締切: ${fields.deadlineAt}`, size: "sm", color: "#616061", wrap: true },
              { type: "text", text: fields.statusLabel, size: "xs", color: "#027a48", weight: "bold" }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#ff7a00",
            action: {
              type: "postback",
              label: messageCard.primaryAction.label,
              data: messageCard.primaryAction.data,
              displayText: messageCard.primaryAction.label
            }
          }
        ]
      }
    }
  };
}

function findProposalNotification(store, managementId) {
  return store.notifications.find((notification) =>
    notification.type === "line_group_proposal_card" && notification.managementId === managementId
  );
}

function getOrCreateProposalNotification(store, proposal, timestamp = nowIso()) {
  const messageCard = buildMessageCard(store, proposal);
  const lineMessage = buildLinePushMessage(store, proposal);
  const existing = findProposalNotification(store, proposal.managementId);
  if (existing) {
    existing.targetId = proposal.groupId;
    existing.payload = { messageCard, lineMessage };
    return existing;
  }
  const notification = {
    notificationId: `ntf_${store.notifications.length + 1}`,
    type: "line_group_proposal_card",
    managementId: proposal.managementId,
    targetType: "group",
    targetId: proposal.groupId,
    payload: { messageCard, lineMessage },
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  store.notifications.push(notification);
  return notification;
}

function proposalResponse(store, proposal, notification) {
  return {
    managementId: proposal.managementId,
    status: proposal.status,
    applyUrl: proposalApplyUrl(store, proposal.managementId),
    messageCard: buildMessageCard(store, proposal),
    postStatus: {
      attempted: Boolean(notification),
      delivered: notification?.status === "delivered",
      targetGroupId: proposal.groupId,
      error: notification?.status === "failed" ? notification.errorMessage : undefined
    }
  };
}

async function deliverProposalPost(store, proposal) {
  if (!proposal.groupId) {
    throw httpError(400, "LINEグループ内から開き直してください。", "group_context_required");
  }

  const notification = getOrCreateProposalNotification(store, proposal);
  if (notification.status === "delivered") {
    return proposalResponse(store, proposal, notification);
  }

  notification.status = "sending";
  notification.updatedAt = nowIso();
  publishEvent(store, "notification_requested", { type: "line_group_proposal_card", managementId: proposal.managementId });

  try {
    if (!store.lineMessagingClient || typeof store.lineMessagingClient.pushMessage !== "function") {
      throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
    }
    notification.providerResponse = await store.lineMessagingClient.pushMessage(notification.targetId, notification.payload.lineMessage);
    notification.status = "delivered";
    notification.deliveredAt = nowIso();
    notification.updatedAt = notification.deliveredAt;
    notification.errorMessage = "";
    publishEvent(store, "notification_delivered", { type: notification.type, managementId: proposal.managementId });
    return proposalResponse(store, proposal, notification);
  } catch (error) {
    notification.status = "failed";
    notification.errorMessage = error.message || "LINE post failed.";
    notification.failedAt = nowIso();
    notification.updatedAt = notification.failedAt;
    publishEvent(store, "notification_failed", { type: notification.type, managementId: proposal.managementId, reason: notification.errorMessage });
    const wrapped = httpError(502, "グループへの自動投稿に失敗しました。もう一度試してください。", "line_post_failed");
    wrapped.managementId = proposal.managementId;
    wrapped.postStatus = {
      attempted: true,
      delivered: false,
      targetGroupId: proposal.groupId,
      error: notification.errorMessage
    };
    wrapped.idempotentResponse = {
      error: wrapped.code,
      message: wrapped.message,
      managementId: proposal.managementId,
      postStatus: wrapped.postStatus
    };
    throw wrapped;
  }
}

function bootstrapProfile(store, input) {
  return withIdempotency(store, input.idempotencyKey, "profile/bootstrap", () => {
    const lineUserId = lineUserFromToken(input.idToken);
    const existing = store.users.get(lineUserId);
    const isFirstUse = !existing;
    const user = mergeUserProfile(store, lineUserId);
    if (isFirstUse) {
      publishEvent(store, "user_first_seen", { lineUserId });
    }
    return {
      lineUserId,
      displayName: user.displayName,
      isFirstUse,
      profileCompleteness: profileCompleteness(user),
      defaults: {
        defaultPayPayId: user.defaultPayPayId,
        defaultPaymentLabel: user.defaultPaymentLabel,
        defaultDeadlineHour: user.defaultDeadlineHour,
        defaultNotes: user.defaultNotes
      },
      available: true
    };
  });
}

async function createProposal(store, input) {
  return withIdempotencyAsync(store, input.idempotencyKey, "proposal/create", async () => {
    const proposerLineUserId = lineUserFromToken(input.idToken);
    const proposalInput = input.proposal || {};
    const groupId = String(proposalInput.groupId || proposalInput.roomId || "").trim();
    if (!groupId) {
      throw httpError(400, "LINEグループ内から開き直してください。", "group_context_required");
    }
    const productName = requireString(proposalInput.productName, "proposal.productName");
    const totalPrice = asPositiveInteger(proposalInput.totalPrice, "proposal.totalPrice");
    const itemCount = asPositiveInteger(proposalInput.itemCount, "proposal.itemCount");
    const deadlineAt = requireString(proposalInput.deadlineAt, "proposal.deadlineAt");
    const hostWantedCount = asPositiveInteger(proposalInput.hostWantedCount || 1, "proposal.hostWantedCount");
    const paymentId = optionalString(proposalInput.paymentId);
    if (!paymentId) {
      throw httpError(400, "PayPay IDを入力してください。", "payment_id_required");
    }
    const paymentLabel = String(proposalInput.paymentLabel || store.config.defaultPaymentLabel);

    store.seq += 1;
    const managementId = `WK-${todayKey()}-${String(store.seq).padStart(4, "0")}`;
    const timestamp = nowIso();
    mergeUserProfile(store, proposerLineUserId, {
      defaultPayPayId: paymentId,
      defaultPaymentLabel: paymentLabel,
      firstProposalCreatedAt: store.users.get(proposerLineUserId)?.firstProposalCreatedAt || timestamp
    }, timestamp);
    const proposal = {
      managementId,
      groupId,
      proposerLineUserId,
      proposerName: proposalInput.proposerName || "LINE User",
      productName,
      productUrl: String(proposalInput.productUrl || ""),
      totalPrice,
      itemCount,
      hostWantedCount,
      deadlineAt,
      paymentId,
      paymentLabel,
      notes: String(proposalInput.notes || ""),
      status: "collecting",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.proposals.set(managementId, proposal);
    recordAudit(store, proposerLineUserId, "proposal_created", "proposal", managementId, null, proposal);
    publishEvent(store, "proposal_created", { managementId, groupId: proposal.groupId });

    return deliverProposalPost(store, proposal);
  });
}

async function postProposal(store, input) {
  const managementId = requireString(input.managementId, "managementId");
  return withIdempotencyAsync(store, input.idempotencyKey, `proposal/post:${managementId}`, async () => {
    lineUserFromToken(input.idToken);
    const proposal = store.proposals.get(managementId);
    if (!proposal) {
      throw httpError(404, "Proposal was not found.", "not_found");
    }
    return deliverProposalPost(store, proposal);
  });
}

function getProposal(store, managementId) {
  const proposal = store.proposals.get(requireString(managementId, "managementId"));
  if (!proposal) {
    throw httpError(404, "Proposal was not found.", "not_found");
  }
  return { ...proposal };
}

function assertCollecting(proposal) {
  if (proposal.status !== "collecting") {
    throw httpError(409, "Proposal is not collecting applications.", "proposal_closed");
  }
  if (proposal.deadlineAt && new Date(proposal.deadlineAt).getTime() <= Date.now()) {
    throw httpError(409, "Proposal deadline has passed.", "proposal_deadline_passed");
  }
}

function upsertApplication(store, input) {
  return withIdempotency(store, input.idempotencyKey, "application/upsert", () => {
    const managementId = requireString(input.managementId, "managementId");
    const proposal = getProposal(store, managementId);
    assertCollecting(proposal);

    const lineUserId = input.lineUserId || lineUserFromToken(input.idToken);
    const wantedCount = asPositiveInteger(input.wantedCount, "wantedCount");
    const key = `${managementId}:${lineUserId}`;
    const before = store.applications.get(key) || null;
    const timestamp = nowIso();
    const user = mergeUserProfile(store, lineUserId, {
      displayName: input.displayName,
      firstApplicationAppliedAt: store.users.get(lineUserId)?.firstApplicationAppliedAt || timestamp
    }, timestamp);
    const application = {
      applicantManagementId: key,
      managementId,
      groupId: input.groupId || proposal.groupId || "",
      lineUserId,
      displayName: input.displayName || before?.displayName || "LINE User",
      wantedCount,
      status: "applied",
      createdAt: before?.createdAt || timestamp,
      updatedAt: timestamp
    };
    store.applications.set(key, application);
    recordAudit(store, lineUserId, before ? "application_updated" : "application_created", "application", key, before, application);
    publishEvent(store, "application_applied", { managementId, lineUserId, wantedCount, updated: Boolean(before) });
    if (user.dmReachable) {
      publishEvent(store, "payment_handoff_ready", { managementId, lineUserId });
    } else {
      publishEvent(store, "dm_failed", { managementId, lineUserId, reason: "friend_required" });
    }

    return {
      applicantManagementId: key,
      managementId,
      wantedCount,
      status: "applied",
      updated: Boolean(before),
      dmReachable: Boolean(user.dmReachable),
      friendRequired: !user.dmReachable,
      addFriendUrl: store.config.addFriendUrl
    };
  });
}

function createPaymentRequest(store, input) {
  return withIdempotency(store, input.idempotencyKey, "payment/request", () => {
    const managementId = requireString(input.managementId, "managementId");
    const lineUserId = requireString(input.lineUserId, "lineUserId");
    const proposal = getProposal(store, managementId);
    const application = store.applications.get(`${managementId}:${lineUserId}`);
    if (!application) {
      throw httpError(404, "Application was not found.", "not_found");
    }

    const amount = unitPrice(proposal.totalPrice, proposal.itemCount) * application.wantedCount;
    const orderId = `ord_${managementId}_${lineUserId}`;
    const paymentId = `pay_${managementId}_${lineUserId}`;
    const timestamp = nowIso();

    const order = {
      orderId,
      managementId,
      lineUserId,
      amount,
      status: "payment_requested",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const payment = {
      paymentId,
      orderId,
      provider: "paypay_p2p_instruction",
      providerReference: proposal.paymentId,
      amount,
      status: "requested",
      instructionText: `${proposal.paymentLabel || "PayPay"} ID: ${proposal.paymentId || "(未設定)"} に ${amount.toLocaleString("ja-JP")}円を送金してください。`,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.orders.set(orderId, order);
    store.payments.set(paymentId, payment);
    recordAudit(store, lineUserId, "payment_requested", "payment", paymentId, null, payment);
    publishEvent(store, "payment_requested", { paymentId, orderId, managementId, lineUserId });
    return payment;
  });
}

function recordPaymentEvent(store, input) {
  return withIdempotency(store, input.idempotencyKey || input.eventId, "payment/webhook", () => {
    const paymentId = requireString(input.paymentId, "paymentId");
    const payment = store.payments.get(paymentId);
    if (!payment) {
      throw httpError(404, "Payment was not found.", "not_found");
    }

    const event = {
      eventId: requireString(input.eventId || input.idempotencyKey, "eventId"),
      paymentId,
      provider: input.provider || payment.provider,
      providerReference: input.providerReference || payment.providerReference,
      status: requireString(input.status, "status"),
      raw: input.raw || null,
      createdAt: nowIso()
    };
    store.paymentEvents.push(event);

    if (event.status === "COMPLETED" || event.status === "paid") {
      payment.status = "paid";
      payment.updatedAt = nowIso();
      const order = store.orders.get(payment.orderId);
      if (order) {
        order.status = "paid";
        order.updatedAt = nowIso();
      }
      publishEvent(store, "payment_completed", { paymentId, orderId: payment.orderId });
    }

    return { accepted: true, paymentId, status: payment.status };
  });
}

function reconcilePayments(store, input) {
  return withIdempotency(store, input.idempotencyKey, "payment/reconcile", () => {
    const results = [];
    for (const item of input.payments || []) {
      const payment = store.payments.get(item.paymentId);
      if (!payment) {
        results.push({ paymentId: item.paymentId, status: "missing" });
        continue;
      }
      if (item.status === "COMPLETED" || item.status === "paid") {
        payment.status = "paid";
        payment.updatedAt = nowIso();
        const order = store.orders.get(payment.orderId);
        if (order) {
          order.status = "paid";
          order.updatedAt = nowIso();
        }
        publishEvent(store, "payment_completed", { paymentId: payment.paymentId, orderId: payment.orderId, source: "reconcile" });
      }
      results.push({ paymentId: payment.paymentId, status: payment.status });
    }
    return { reconciled: results.length, results };
  });
}

function parsePostback(data) {
  const params = new URLSearchParams(data || "");
  return Object.fromEntries(params.entries());
}

function handleLineWebhook(store, input) {
  const events = Array.isArray(input.events) ? input.events : [];
  const replies = [];
  for (const event of events) {
    if (event.type !== "postback") {
      continue;
    }
    const data = parsePostback(event.postback?.data);
    const managementId = data.managementId;
    const source = event.source || {};
    const idempotencyKey = event.webhookEventId || `${event.replyToken}:${event.postback?.data}`;

    if (data.action === "want") {
      const proposal = getProposal(store, managementId);
      assertCollecting(proposal);
      replies.push({
        replyToken: event.replyToken,
        type: "quantity_options",
        managementId,
        options: [
          { label: "1個", data: `action=apply&managementId=${managementId}&wantedCount=1` },
          { label: "2個", data: `action=apply&managementId=${managementId}&wantedCount=2` },
          { label: "3個", data: `action=apply&managementId=${managementId}&wantedCount=3` },
          { label: "その他", data: `action=other_quantity&managementId=${managementId}` }
        ]
      });
      continue;
    }

    if (data.action === "apply") {
      if (!["1", "2", "3"].includes(String(data.wantedCount))) {
        throw httpError(400, "LINE quantity postback only accepts 1, 2, or 3.", "invalid_chat_quantity");
      }
      const saved = upsertApplication(store, {
        idempotencyKey,
        managementId,
        wantedCount: data.wantedCount,
        lineUserId: source.userId,
        groupId: source.groupId || source.roomId || "",
        displayName: source.userId || "LINE User"
      });
      replies.push({
        replyToken: event.replyToken,
        type: "application_saved",
        managementId,
        wantedCount: saved.wantedCount,
        friendRequired: saved.friendRequired,
        addFriendUrl: saved.addFriendUrl
      });
      continue;
    }

    if (data.action === "other_quantity") {
      replies.push({
        replyToken: event.replyToken,
        type: "open_liff",
        uri: proposalApplyUrl(store, managementId, { mode: "other" })
      });
    }
  }
  return { ok: true, replies };
}

function metrics(store) {
  const proposalCount = store.proposals.size;
  const applicationCount = store.applications.size;
  const paidCount = Array.from(store.payments.values()).filter((payment) => payment.status === "paid").length;
  const gmv = Array.from(store.orders.values()).reduce((sum, order) => sum + Number(order.amount || 0), 0);
  return {
    proposalCount,
    applicationCount,
    orderCount: store.orders.size,
    paymentCount: store.payments.size,
    paidCount,
    gmv,
    pendingEventCount: store.events.filter((event) => event.status === "pending").length,
    failedNotificationCount: store.notifications.filter((notification) => notification.status === "failed").length
  };
}

module.exports = {
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
  inferProductCount,
  httpError
};
