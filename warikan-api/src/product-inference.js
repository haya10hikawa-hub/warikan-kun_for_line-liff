"use strict";

const COUNT_UNITS = [
  "個入り",
  "本入り",
  "枚入り",
  "袋入り",
  "個入",
  "本入",
  "枚入",
  "袋入",
  "パック",
  "セット",
  "ケース",
  "カートン",
  "ロール",
  "枚",
  "本",
  "個",
  "袋",
  "箱",
  "缶",
  "包",
  "巻",
  "食",
  "粒",
  "錠"
];

const CAPACITY_UNITS = ["ml", "mL", "ML", "l", "L", "g", "G", "kg", "KG", "円", "%"];
const CAMPAIGN_PATTERN = /(買えば|買うと|もう\s*1|おまけ|無料|プレゼント|キャンペーン|増量|実質|ポイント)/;

function normalizeText(value) {
  return String(value || "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[×＊✕]/g, "×")
    .replace(/\s+/g, " ")
    .trim();
}

function autoApplyFor(sourceLayer, confidence) {
  if (sourceLayer === "regex") {
    return confidence >= 0.9;
  }
  if (sourceLayer === "html") {
    return confidence >= 0.85;
  }
  if (sourceLayer === "ai") {
    return confidence >= 0.92;
  }
  return false;
}

function result(itemCount, unit, confidence, sourceLayer, reason) {
  return {
    itemCount,
    unit,
    confidence,
    sourceLayer,
    reason,
    autoApply: autoApplyFor(sourceLayer, confidence)
  };
}

function noResult(sourceLayer = "none", reason = "手入力してください") {
  return {
    itemCount: null,
    unit: "",
    confidence: 0,
    sourceLayer,
    reason,
    autoApply: false
  };
}

function isCapacityUnit(unit) {
  return CAPACITY_UNITS.includes(String(unit || ""));
}

function parsePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 10000) {
    return null;
  }
  return number;
}

function inferCountFromText(rawText, sourceLayer = "regex") {
  const text = normalizeText(rawText);
  if (!text) {
    return noResult(sourceLayer);
  }

  const countUnitPattern = COUNT_UNITS.join("|");
  const multiplicationPattern = new RegExp(`(\\d+)\\s*(${countUnitPattern})\\s*×\\s*(\\d+)\\s*(${countUnitPattern})`, "g");
  let match = multiplicationPattern.exec(text);
  if (match) {
    const left = parsePositiveInteger(match[1]);
    const right = parsePositiveInteger(match[3]);
    if (left && right) {
      return result(left * right, match[2], sourceLayer === "html" ? 0.9 : 0.96, sourceLayer, `${match[0]} から推定`);
    }
  }

  const compactMultiplicationPattern = new RegExp(`(\\d+)\\s*(${countUnitPattern})\\s*×\\s*(\\d+)`, "g");
  match = compactMultiplicationPattern.exec(text);
  if (match) {
    const left = parsePositiveInteger(match[1]);
    const right = parsePositiveInteger(match[3]);
    if (left && right) {
      return result(left * right, match[2], sourceLayer === "html" ? 0.88 : 0.94, sourceLayer, `${match[0]} から推定`);
    }
  }

  const countMatches = [];
  const directPattern = new RegExp(`(\\d+)\\s*(${countUnitPattern})`, "g");
  while ((match = directPattern.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 4), match.index);
    const unit = match[2];
    const itemCount = parsePositiveInteger(match[1]);
    if (!itemCount || isCapacityUnit(unit)) {
      continue;
    }
    if (/[a-zA-Z]$/.test(before)) {
      continue;
    }
    countMatches.push({ itemCount, unit, raw: match[0] });
  }

  if (!countMatches.length) {
    return noResult(sourceLayer);
  }

  if (CAMPAIGN_PATTERN.test(text) && countMatches.length > 1) {
    return noResult(sourceLayer, "キャンペーン表現を含むため手入力してください");
  }

  const selected = countMatches[countMatches.length - 1];
  return result(
    selected.itemCount,
    selected.unit,
    sourceLayer === "html" ? 0.88 : 0.92,
    sourceLayer,
    `${selected.raw} から推定`
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function extractJsonLdText(html) {
  const chunks = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          chunks.push(item.name, item.description, item.sku, item.size);
        }
      }
    } catch (_error) {
      chunks.push(stripTags(match[1]));
    }
  }
  return chunks.filter(Boolean).join(" ");
}

function extractSafeHtmlText(html) {
  const source = String(html || "")
    .replace(/<script(?![^>]+application\/ld\+json)[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const chunks = [];
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    chunks.push(stripTags(title[1]));
  }
  const metaPattern = /<meta[^>]+(?:name|property)=["'][^"']*(?:title|description|item_name|product)[^"']*["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(source))) {
    chunks.push(decodeHtmlEntities(match[1]));
  }
  const tablePattern = /<table[\s\S]*?<\/table>/gi;
  while ((match = tablePattern.exec(source))) {
    chunks.push(stripTags(match[0]));
  }
  const itemNamePattern = /<(?:[^>]+)(?:id|class)=["'][^"']*item[_-]?name[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = itemNamePattern.exec(source))) {
    chunks.push(stripTags(match[1]));
  }
  chunks.push(extractJsonLdText(source));
  return chunks.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 4000);
}

function inferenceCacheKey(input) {
  const itemUrl = String(input.itemUrl || "").trim();
  if (itemUrl) {
    return `url:${itemUrl}`;
  }
  return `item:${normalizeText(input.itemName)}:${normalizeText(input.shopName)}:${Number(input.price || 0)}`;
}

function sanitizeAiResult(value) {
  if (!value || typeof value !== "object") {
    return noResult("ai");
  }
  const itemCount = parsePositiveInteger(value.itemCount);
  const confidence = Math.max(0, Math.min(1, Number(value.confidence || 0)));
  if (!itemCount || confidence <= 0) {
    return noResult("ai", value.reason || "AI解析では確定できませんでした");
  }
  return result(itemCount, String(value.unit || ""), confidence, "ai", String(value.reason || "AI解析による推定"));
}

async function inferProductCount(store, input = {}) {
  const normalized = {
    itemName: normalizeText(input.itemName),
    itemUrl: String(input.itemUrl || "").trim(),
    price: Number(input.price || 0),
    shopName: normalizeText(input.shopName)
  };
  const cacheKey = inferenceCacheKey(normalized);
  if (store.productInferenceCache?.has(cacheKey)) {
    return { ...store.productInferenceCache.get(cacheKey), cached: true };
  }

  const regex = inferCountFromText(normalized.itemName, "regex");
  if (regex.autoApply) {
    store.productInferenceCache?.set(cacheKey, regex);
    return regex;
  }

  let safeHtmlText = "";
  if (normalized.itemUrl && store.htmlFetchClient?.fetchHtml) {
    try {
      const html = await store.htmlFetchClient.fetchHtml(normalized.itemUrl);
      safeHtmlText = extractSafeHtmlText(html);
      const htmlResult = inferCountFromText(`${normalized.itemName} ${safeHtmlText}`, "html");
      if (htmlResult.autoApply) {
        store.productInferenceCache?.set(cacheKey, htmlResult);
        return htmlResult;
      }
    } catch (_error) {
      safeHtmlText = "";
    }
  }

  if (store.openAiClient?.inferCount) {
    try {
      const ai = sanitizeAiResult(await store.openAiClient.inferCount({ ...normalized, safeHtmlText }));
      if (ai.autoApply) {
        store.productInferenceCache?.set(cacheKey, ai);
        return ai;
      }
      store.productInferenceCache?.set(cacheKey, ai);
      return ai;
    } catch (_error) {
      const fallback = noResult("ai", "AI解析に失敗しました。手入力してください");
      store.productInferenceCache?.set(cacheKey, fallback);
      return fallback;
    }
  }

  const fallback = noResult("none");
  store.productInferenceCache?.set(cacheKey, fallback);
  return fallback;
}

module.exports = {
  inferCountFromText,
  extractSafeHtmlText,
  inferProductCount,
  inferenceCacheKey
};
