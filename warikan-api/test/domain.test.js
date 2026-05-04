"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createStore,
  bootstrapProfile,
  createProposal,
  postProposal,
  upsertApplication,
  createPaymentRequest,
  recordPaymentEvent,
  reconcilePayments,
  handleLineWebhook,
  metrics,
  inferProductCount
} = require("../src/domain");
const { inferCountFromText } = require("../src/product-inference");

function createPushClient(options = {}) {
  return {
    calls: [],
    fail: Boolean(options.fail),
    async pushMessage(to, message) {
      this.calls.push({ to, message });
      if (this.fail) {
        throw new Error("line unavailable");
      }
      return { ok: true, requestId: `line-${this.calls.length}` };
    }
  };
}

function createTestStore(options = {}) {
  return createStore({
    lineMessagingClient: options.lineMessagingClient || createPushClient(),
    htmlFetchClient: options.htmlFetchClient,
    openAiClient: options.openAiClient
  });
}

async function seedProposal(store) {
  bootstrapProfile(store, {
    idempotencyKey: "profile-1",
    idToken: "line:U-host"
  });
  return createProposal(store, {
    idempotencyKey: "proposal-1",
    idToken: "line:U-host",
    proposal: {
      groupId: "C-group",
      productName: "テスト商品 24個",
      totalPrice: 4800,
      itemCount: 24,
      hostWantedCount: 1,
      deadlineAt: "2099-05-04T21:00",
      paymentId: "host-paypay",
      paymentLabel: "PayPay"
    }
  });
}

test("proposal create posts to LINE group and is idempotent", async () => {
  const lineMessagingClient = createPushClient();
  const store = createTestStore({ lineMessagingClient });
  const first = await seedProposal(store);
  const replay = await createProposal(store, {
    idempotencyKey: "proposal-1",
    idToken: "line:U-host",
    proposal: {
      productName: "別商品",
      totalPrice: 9999,
      itemCount: 1,
      deadlineAt: "2099-05-04T21:00"
    }
  });

  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.managementId, first.managementId);
  assert.equal(first.postStatus.delivered, true);
  assert.equal(store.proposals.size, 1);
  assert.equal(lineMessagingClient.calls.length, 1);
  assert.equal(store.notifications[0].status, "delivered");
});

test("proposal create requires group context", async () => {
  const store = createTestStore();
  await assert.rejects(
    () => createProposal(store, {
      idempotencyKey: "proposal-missing-group",
      idToken: "line:U-host",
      proposal: {
        productName: "テスト商品 24個",
        totalPrice: 4800,
        itemCount: 24,
        hostWantedCount: 1,
        deadlineAt: "2099-05-04T21:00"
      }
    }),
    { code: "group_context_required" }
  );
  assert.equal(store.proposals.size, 0);
});

test("profile bootstrap records first use and profile completeness", () => {
  const store = createTestStore();
  const first = bootstrapProfile(store, {
    idempotencyKey: "profile-first-1",
    idToken: "line:U-new-host"
  });
  const second = bootstrapProfile(store, {
    idempotencyKey: "profile-first-2",
    idToken: "line:U-new-host"
  });

  assert.equal(first.isFirstUse, true);
  assert.equal(first.profileCompleteness.hasDefaultPayPayId, false);
  assert.equal(second.isFirstUse, false);
  assert.ok(store.users.get("U-new-host").createdAt);
  assert.equal(store.events.some((event) => event.type === "user_first_seen"), true);
});

test("proposal create requires PayPay ID before saving", async () => {
  const store = createTestStore();
  bootstrapProfile(store, {
    idempotencyKey: "profile-payment-required",
    idToken: "line:U-host"
  });

  await assert.rejects(
    () => createProposal(store, {
      idempotencyKey: "proposal-missing-payment",
      idToken: "line:U-host",
      proposal: {
        groupId: "C-group",
        productName: "テスト商品 24個",
        totalPrice: 4800,
        itemCount: 24,
        hostWantedCount: 1,
        deadlineAt: "2099-05-04T21:00"
      }
    }),
    { code: "payment_id_required" }
  );
  assert.equal(store.proposals.size, 0);
});

test("proposal create saves first proposal timestamp and PayPay defaults", async () => {
  const store = createTestStore();
  await seedProposal(store);
  const user = store.users.get("U-host");

  assert.equal(user.defaultPayPayId, "host-paypay");
  assert.equal(user.defaultPaymentLabel, "PayPay");
  assert.ok(user.firstProposalCreatedAt);
});

test("LINE post failure keeps proposal and allows retry without duplicate delivery", async () => {
  const lineMessagingClient = createPushClient({ fail: true });
  const store = createTestStore({ lineMessagingClient });
  let failedManagementId = "";

  await assert.rejects(
    async () => {
      try {
        await seedProposal(store);
      } catch (error) {
        failedManagementId = error.managementId;
        throw error;
      }
    },
    { code: "line_post_failed" }
  );

  assert.ok(failedManagementId);
  assert.equal(store.proposals.size, 1);
  assert.equal(store.notifications[0].status, "failed");

  await assert.rejects(
    () => createProposal(store, {
      idempotencyKey: "proposal-1",
      idToken: "line:U-host",
      proposal: {
        groupId: "C-group",
        productName: "別商品",
        totalPrice: 9999,
        itemCount: 1,
        hostWantedCount: 1,
        deadlineAt: "2099-05-04T21:00"
      }
    }),
    { code: "line_post_failed" }
  );
  assert.equal(store.proposals.size, 1);
  assert.equal(lineMessagingClient.calls.length, 1);

  lineMessagingClient.fail = false;
  const posted = await postProposal(store, {
    idempotencyKey: "proposal-post-1",
    idToken: "line:U-host",
    managementId: failedManagementId
  });
  const replay = await postProposal(store, {
    idempotencyKey: "proposal-post-1",
    idToken: "line:U-host",
    managementId: failedManagementId
  });

  assert.equal(posted.postStatus.delivered, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(store.notifications[0].status, "delivered");
  assert.equal(lineMessagingClient.calls.length, 2);
});

test("application upsert updates quantity without duplicate application rows", async () => {
  const store = createTestStore();
  const proposal = await seedProposal(store);

  const first = upsertApplication(store, {
    idempotencyKey: "apply-1",
    idToken: "line:U-user",
    managementId: proposal.managementId,
    wantedCount: 1
  });
  const second = upsertApplication(store, {
    idempotencyKey: "apply-2",
    idToken: "line:U-user",
    managementId: proposal.managementId,
    wantedCount: 3
  });

  assert.equal(first.updated, false);
  assert.equal(second.updated, true);
  assert.equal(store.applications.size, 1);
  assert.equal(store.applications.get(`${proposal.managementId}:U-user`).wantedCount, 3);
  assert.ok(store.users.get("U-user").firstApplicationAppliedAt);
  assert.equal(store.auditLogs.filter((log) => log.targetType === "application").length, 2);
});

test("duplicate LINE postback is replayed through idempotency", async () => {
  const store = createTestStore();
  const proposal = await seedProposal(store);

  const payload = {
    events: [
      {
        type: "postback",
        webhookEventId: "line-event-1",
        replyToken: "reply-1",
        source: { type: "group", groupId: "C-group", userId: "U-user" },
        postback: { data: `action=apply&managementId=${proposal.managementId}&wantedCount=2` }
      }
    ]
  };

  const first = handleLineWebhook(store, payload);
  const replay = handleLineWebhook(store, payload);

  assert.equal(first.replies[0].wantedCount, 2);
  assert.equal(replay.replies[0].wantedCount, 2);
  assert.equal(store.applications.size, 1);
  assert.equal(store.auditLogs.filter((log) => log.targetType === "application").length, 1);
  assert.equal(store.events.some((event) => event.type === "dm_failed"), true);
});

test("want postback returns chat quantities and routes other quantity to LIFF", async () => {
  const store = createTestStore();
  const proposal = await seedProposal(store);

  const want = handleLineWebhook(store, {
    events: [
      {
        type: "postback",
        webhookEventId: "line-want-1",
        replyToken: "reply-want",
        source: { type: "group", groupId: "C-group", userId: "U-user" },
        postback: { data: `action=want&managementId=${proposal.managementId}` }
      }
    ]
  });
  assert.equal(want.replies[0].type, "quantity_options");
  assert.deepEqual(want.replies[0].options.map((option) => option.label), ["1個", "2個", "3個", "その他"]);
  assert.equal(want.replies[0].options[3].data, `action=other_quantity&managementId=${proposal.managementId}`);

  const other = handleLineWebhook(store, {
    events: [
      {
        type: "postback",
        webhookEventId: "line-other-1",
        replyToken: "reply-other",
        source: { type: "group", groupId: "C-group", userId: "U-user" },
        postback: { data: `action=other_quantity&managementId=${proposal.managementId}` }
      }
    ]
  });
  assert.equal(other.replies[0].type, "open_liff");
  assert.match(other.replies[0].uri, /mode=other/);
});

test("payment request, webhook, and reconciliation update payment state", async () => {
  const store = createTestStore();
  const proposal = await seedProposal(store);
  upsertApplication(store, {
    idempotencyKey: "apply-payment",
    idToken: "line:U-user",
    managementId: proposal.managementId,
    wantedCount: 2
  });

  const payment = createPaymentRequest(store, {
    idempotencyKey: "payment-request-1",
    managementId: proposal.managementId,
    lineUserId: "U-user"
  });
  assert.equal(payment.amount, 400);
  assert.equal(payment.status, "requested");

  const webhookResult = recordPaymentEvent(store, {
    idempotencyKey: "payment-webhook-1",
    eventId: "paypay-event-1",
    paymentId: payment.paymentId,
    status: "COMPLETED"
  });
  assert.equal(webhookResult.status, "paid");

  const reconcile = reconcilePayments(store, {
    idempotencyKey: "reconcile-1",
    payments: [{ paymentId: payment.paymentId, status: "paid" }]
  });
  assert.equal(reconcile.results[0].status, "paid");
  assert.equal(metrics(store).paidCount, 1);
});

test("product count regex handles count patterns and rejects ambiguous campaigns", () => {
  assert.equal(inferCountFromText("コカ・コーラ 500ml 24本").itemCount, 24);
  assert.equal(inferCountFromText("マスク 30枚×2箱").itemCount, 60);
  assert.equal(inferCountFromText("お茶 2L 6本").itemCount, 6);
  assert.equal(inferCountFromText("500ml").itemCount, null);
  assert.equal(inferCountFromText("2個買えばもう1個").itemCount, null);
});

test("product count inference reads safe HTML before AI", async () => {
  const store = createTestStore({
    htmlFetchClient: {
      async fetchHtml() {
        return "<html><head><title>商品</title></head><body><table><tr><th>内容量</th><td>24本</td></tr></table></body></html>";
      }
    },
    openAiClient: {
      async inferCount() {
        throw new Error("AI should not run when HTML is confident.");
      }
    }
  });

  const result = await inferProductCount(store, {
    itemName: "ケース販売",
    itemUrl: "https://example.com/item",
    price: 4800,
    shopName: "Example"
  });

  assert.equal(result.sourceLayer, "html");
  assert.equal(result.itemCount, 24);
  assert.equal(result.autoApply, true);
});

test("product count inference uses AI fallback and caches by item URL", async () => {
  let aiCalls = 0;
  const store = createTestStore({
    htmlFetchClient: {
      async fetchHtml() {
        return "<title>キャンペーン商品</title><table><tr><th>特典</th><td>2個買えばもう1個</td></tr></table>";
      }
    },
    openAiClient: {
      async inferCount() {
        aiCalls += 1;
        return { itemCount: 3, unit: "個", confidence: 0.95, reason: "セット表記から推定" };
      }
    }
  });
  const input = {
    itemName: "キャンペーンまとめ買い",
    itemUrl: "https://example.com/campaign",
    price: 1500,
    shopName: "Example"
  };

  const first = await inferProductCount(store, input);
  const replay = await inferProductCount(store, input);

  assert.equal(first.sourceLayer, "ai");
  assert.equal(first.itemCount, 3);
  assert.equal(first.autoApply, true);
  assert.equal(replay.cached, true);
  assert.equal(aiCalls, 1);
});

test("product count inference does not auto apply low confidence AI", async () => {
  const store = createTestStore({
    openAiClient: {
      async inferCount() {
        return { itemCount: 3, unit: "個", confidence: 0.6, reason: "確信度が低い" };
      }
    }
  });

  const result = await inferProductCount(store, {
    itemName: "数量不明セット",
    price: 1200,
    shopName: "Example"
  });

  assert.equal(result.sourceLayer, "ai");
  assert.equal(result.itemCount, 3);
  assert.equal(result.autoApply, false);
});
