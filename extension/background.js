const BACKEND_CHAT_URL = "";

const CHATGPT_URL_PREFIXES = [
  "https://chatgpt.com/",
  "https://chat.openai.com/"
];

function isChatGptConversationUrl(url) {
  return CHATGPT_URL_PREFIXES.some((prefix) => (url || "").startsWith(prefix));
}

function normalizeComparisonText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toInteger(value) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) ? parsedValue : null;
}

function dedupeStrings(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeComparisonText(value))
        .filter(Boolean)
    )
  );
}

function formatCitation(value) {
  if (typeof value === "string") {
    return normalizeComparisonText(value);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  return normalizeComparisonText(
    value.title ||
      value.fileName ||
      value.displayName ||
      value.name ||
      value.label ||
      value.url ||
      value.href ||
      ""
  ) || null;
}

function normalizeCitations(item) {
  return dedupeStrings([
    ...(Array.isArray(item?.citations) ? item.citations.map(formatCitation) : []),
    ...(Array.isArray(item?.sources) ? item.sources.map(formatCitation) : []),
    ...(Array.isArray(item?.evidence) ? item.evidence.map(formatCitation) : []),
    ...(Array.isArray(item?.references) ? item.references.map(formatCitation) : []),
    ...(typeof item?.citations === "string" ? [item.citations] : []),
    ...(typeof item?.sources === "string" ? [item.sources] : []),
    ...(typeof item?.evidence === "string" ? [item.evidence] : []),
    ...(typeof item?.references === "string" ? [item.references] : [])
  ]);
}

function buildTargetHints(container, inheritedHints = {}) {
  if (!container || typeof container !== "object") {
    return inheritedHints;
  }

  const nextHints = { ...inheritedHints };

  if (container.id != null) {
    nextHints.messageId = container.id;
  }
  if (container.messageId != null) {
    nextHints.messageId = container.messageId;
  }
  if (container.assistantMessageId != null) {
    nextHints.messageId = container.assistantMessageId;
  }
  if (container.index != null) {
    nextHints.messageIndex = container.index;
  }
  if (container.messageIndex != null) {
    nextHints.messageIndex = container.messageIndex;
  }
  if (container.assistantRoleIndex != null) {
    nextHints.assistantRoleIndex = container.assistantRoleIndex;
  }
  if (container.responseIndex != null) {
    nextHints.assistantRoleIndex = container.responseIndex;
  }
  if (container.assistantIndex != null) {
    nextHints.assistantRoleIndex = container.assistantIndex;
  }
  if (container.roleIndex != null) {
    nextHints.roleIndex = container.roleIndex;
  }
  if (container.role != null) {
    nextHints.role = container.role;
  }

  return nextHints;
}

function normalizeHighlightItem(item, targetHints) {
  if (typeof item === "string") {
    return {
      ...targetHints,
      statement: item
    };
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    ...targetHints,
    ...item
  };
}

function collectHighlightEntries(container, targetHints = {}) {
  const items = [];
  const keys = ["highlights", "statements", "claims", "items", "annotations", "results"];

  for (const key of keys) {
    if (!Array.isArray(container?.[key])) {
      continue;
    }

    for (const item of container[key]) {
      const normalizedItem = normalizeHighlightItem(item, targetHints);
      if (normalizedItem) {
        items.push(normalizedItem);
      }
    }
  }

  return items;
}

function collectHighlightCandidates(responseBody) {
  const items = [];
  const visited = new Set();

  function visit(container, inheritedHints = {}) {
    if (!container || typeof container !== "object" || visited.has(container)) {
      return;
    }

    visited.add(container);

    if (Array.isArray(container)) {
      for (const item of container) {
        const normalizedItem = normalizeHighlightItem(item, inheritedHints);
        if (normalizedItem) {
          items.push(normalizedItem);
        }
      }
      return;
    }

    const targetHints = buildTargetHints(container, inheritedHints);
    const directItem = normalizeHighlightItem(container, targetHints);
    if (
      directItem &&
      (directItem.statement || directItem.claim || directItem.sentence)
    ) {
      items.push(directItem);
    }
    items.push(...collectHighlightEntries(container, targetHints));

    for (const key of ["data", "result"]) {
      if (container[key] && typeof container[key] === "object") {
        visit(container[key], targetHints);
      }
    }

    for (const key of ["messages", "responses"]) {
      if (!Array.isArray(container[key])) {
        continue;
      }

      for (const nestedContainer of container[key]) {
        if (!nestedContainer || typeof nestedContainer !== "object") {
          continue;
        }

        const nestedTargetHints = buildTargetHints(nestedContainer, targetHints);
        visit(nestedContainer, nestedTargetHints);
      }
    }
  }

  visit(responseBody);
  return items;
}

function resolveAssistantRoleIndices(item, statement, assistantMessages) {
  const indices = new Set();

  for (const directIndex of [
    item?.assistantRoleIndex,
    item?.responseIndex,
    item?.assistantIndex
  ]) {
    const parsedIndex = toInteger(directIndex);
    if (parsedIndex !== null) {
      indices.add(parsedIndex);
    }
  }

  const roleIndex = toInteger(item?.roleIndex);
  if (roleIndex !== null && (item?.role === "assistant" || item?.messageRole === "assistant")) {
    indices.add(roleIndex);
  }

  const messageIndex = toInteger(item?.messageIndex);
  if (messageIndex !== null) {
    for (const message of assistantMessages) {
      if (message.index === messageIndex) {
        indices.add(message.roleIndex);
      }
    }
  }

  const messageId = item?.messageId || item?.assistantMessageId || item?.id || null;
  if (messageId) {
    for (const message of assistantMessages) {
      if (message.id === messageId) {
        indices.add(message.roleIndex);
      }
    }
  }

  const explicitMatches = Array.from(indices).filter((candidateIndex) =>
    assistantMessages.some((message) => message.roleIndex === candidateIndex)
  );

  if (explicitMatches.length) {
    return explicitMatches;
  }

  const normalizedStatement = normalizeComparisonText(statement).toLowerCase();
  if (!normalizedStatement) {
    return [];
  }

  return assistantMessages
    .filter((message) =>
      normalizeComparisonText(message.text).toLowerCase().includes(normalizedStatement)
    )
    .map((message) => message.roleIndex);
}

function buildHighlightPayloadFromBackend(backendResult, extractedConversation) {
  if (!backendResult?.ok || !backendResult.response) {
    return [];
  }

  const assistantMessages = (extractedConversation?.messages || []).filter(
    (message) => message.role === "assistant"
  );
  const rawItems = collectHighlightCandidates(backendResult.response);
  const highlightItems = [];
  const seen = new Set();

  for (const item of rawItems) {
    const statement = normalizeComparisonText(
      item?.statement || item?.claim || item?.sentence || item?.text || item?.content || ""
    );

    if (!statement) {
      continue;
    }

    const targetIndices = resolveAssistantRoleIndices(item, statement, assistantMessages);
    if (!targetIndices.length) {
      continue;
    }

    const score =
      item?.score ??
      item?.riskScore ??
      item?.risk ??
      item?.hallucinationScore ??
      item?.confidence ??
      item?.probability ??
      "N/A";

    const note = normalizeComparisonText(
      item?.note ||
        item?.explanation ||
        item?.reason ||
        item?.summary ||
        item?.description ||
        "No details available."
    );

    const citations = normalizeCitations(item);

    for (const assistantRoleIndex of targetIndices) {
      const dedupeKey = `${assistantRoleIndex}::${statement.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      highlightItems.push({
        assistantRoleIndex,
        statement,
        score: String(score),
        citations,
        note
      });
    }
  }

  return highlightItems;
}

async function applyHighlightsInTab(tabId, highlightItems) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["dom.js"]
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (payload) => {
      if (typeof window.__hdApplyHighlights !== "function") {
        return {
          ok: false,
          reason: "Highlighter entrypoint was not found in page context."
        };
      }

      const runResult = window.__hdApplyHighlights(payload);
      return {
        ok: true,
        ...runResult
      };
    },
    args: [highlightItems]
  });

  return result;
}

async function sendChatPayloadToBackend(payload) {
  if (!BACKEND_CHAT_URL) {
    return {
      attempted: false,
      reason: "BACKEND_CHAT_URL is not configured."
    };
  }

  try {
    const response = await fetch(BACKEND_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      response: responseBody
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: "network_error",
      error: String(error)
    };
  }
}

function extractChatGptConversationFromPage() {
  const extractionErrors = [];

  function recordExtractionError(step, error) {
    extractionErrors.push({
      step,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function getConversationId() {
    return window.location.pathname.match(/\/c\/([^/?#]+)/)?.[1] || null;
  }

  function getConversationTitle() {
    const rawTitle = document.title.replace(/\s*-\s*ChatGPT\s*$/i, "");
    const title = normalizeText(rawTitle);
    return title || null;
  }

  function getMessageScope(node) {
    return node.closest("article") || node;
  }

  function getMessageContentRoot(node) {
    const scope = getMessageScope(node);
    const selectors = [
      "[data-message-content]",
      "[data-testid='conversation-turn-content']",
      ".markdown",
      "[class*='markdown']",
      "[class*='prose']",
      "[class*='whitespace-pre-wrap']"
    ];

    for (const selector of selectors) {
      const match = scope.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return node;
  }

  function extractMessageText(node) {
    try {
      const contentRoot = getMessageContentRoot(node);
      const text = normalizeText(contentRoot.innerText || contentRoot.textContent || "");
      return text || null;
    } catch (error) {
      recordExtractionError("extract_message_text", error);
      return null;
    }
  }

  function unwrapExternalUrl(rawHref) {
    try {
      const parsedUrl = new URL(rawHref, window.location.href);
      const nestedUrlParams = ["url", "u", "target", "q"];

      for (const param of nestedUrlParams) {
        const nestedUrlValue = parsedUrl.searchParams.get(param);
        if (!nestedUrlValue) {
          continue;
        }

        try {
          const nestedUrl = new URL(nestedUrlValue, window.location.href);
          if (/^https?:$/i.test(nestedUrl.protocol)) {
            return nestedUrl.toString();
          }
        } catch {
          continue;
        }
      }

      return parsedUrl.toString();
    } catch {
      return null;
    }
  }

  function isSupportedSourceUrl(url) {
    try {
      const parsedUrl = new URL(url);
      const isHttp = /^https?:$/i.test(parsedUrl.protocol);
      const isInternalHost =
        parsedUrl.hostname === "chatgpt.com" ||
        parsedUrl.hostname === "chat.openai.com";

      return isHttp && !isInternalHost;
    } catch {
      return false;
    }
  }

  function buildSource(anchor) {
    const rawUrl = anchor.getAttribute("href") || "";
    const normalizedUrl = unwrapExternalUrl(rawUrl);

    if (!normalizedUrl || !isSupportedSourceUrl(normalizedUrl)) {
      return null;
    }

    let host = null;
    try {
      host = new URL(normalizedUrl).hostname;
    } catch {
      host = null;
    }

    const title = normalizeText(
      anchor.innerText ||
        anchor.textContent ||
        anchor.getAttribute("title") ||
        anchor.getAttribute("aria-label") ||
        ""
    );

    const citationMatch = title.match(/^\[(\d+)\]$/);

    return {
      title: title || null,
      url: normalizedUrl,
      host,
      citationLabel: citationMatch ? citationMatch[1] : null,
      rawUrl: rawUrl && rawUrl !== normalizedUrl ? rawUrl : null
    };
  }

  function collectSources(node) {
    const scope = getMessageScope(node);
    const anchors = Array.from(scope.querySelectorAll("a[href]"));
    const dedupedSources = [];
    const seen = new Set();

    for (const anchor of anchors) {
      const source = buildSource(anchor);
      if (!source) {
        continue;
      }

      const dedupeKey = `${source.url}::${source.title || ""}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      dedupedSources.push(source);
    }

    return dedupedSources.map((source, index) => ({
      ...source,
      type: "web",
      index
    }));
  }

  function extractUploadedFilesFromText(text) {
    const fileNameMatches = normalizeText(text).match(
      /\b[^\\/:*?"<>|\n]+\.(pdf|docx?|pptx?|xlsx?|csv|txt)\b/gi
    );

    return Array.from(
      new Set((fileNameMatches || []).map((fileName) => normalizeText(fileName)).filter(Boolean))
    ).map((fileName) => {
      const extension = fileName.split(".").pop()?.toLowerCase() || null;
      const displayName = normalizeText(fileName.replace(/\.[^.]+$/, ""));

      return {
        fileName,
        displayName,
        extension
      };
    });
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function collectReferencedUploads(text, uploadedFiles) {
    const normalizedMessageText = normalizeText(text);

    if (!normalizedMessageText) {
      return [];
    }

    return uploadedFiles
      .filter((file) => {
        const candidates = [file.fileName, file.displayName].filter(Boolean);
        return candidates.some((candidate) =>
          new RegExp(`(^|\\b)${escapeRegExp(candidate)}(\\b|$)`, "i").test(normalizedMessageText)
        );
      })
      .map((file, index) => ({
        index,
        type: "upload",
        title: file.fileName,
        fileName: file.fileName,
        displayName: file.displayName,
        extension: file.extension,
        url: null,
        host: null,
        citationLabel: null,
        rawUrl: null
      }));
  }

  function mergeSources(webSources, uploadSources) {
    const mergedSources = [];
    const seen = new Set();

    for (const source of [...webSources, ...uploadSources]) {
      const dedupeKey = `${source.type}::${source.url || source.fileName || source.title || ""}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      mergedSources.push(source);
    }

    return mergedSources.map((source, index) => ({
      ...source,
      index
    }));
  }

  function getDomId(node) {
    const scope = getMessageScope(node);
    const candidateIds = [
      node.getAttribute("data-testid"),
      scope.getAttribute("data-testid"),
      node.id,
      scope.id
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    return candidateIds[0] || null;
  }

  function extractMessages() {
    const turnNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    const roleCounts = {
      user: 0,
      assistant: 0,
      system: 0,
      tool: 0,
      unknown: 0
    };

    return turnNodes
      .map((node, index) => {
        const role = node.getAttribute("data-message-author-role") || "unknown";
        const roleIndex = roleCounts[role] ?? 0;
        roleCounts[role] = roleIndex + 1;

        const text = extractMessageText(node);

        if (!text) {
          return null;
        }

        return {
          index,
          id: getDomId(node) || `${role}-${roleIndex}`,
          role,
          roleIndex,
          text,
          webSources: role === "assistant" ? collectSources(node) : []
        };
      })
      .filter(Boolean);
  }

  const baseMessages = extractMessages();
  const userMessages = baseMessages.filter((message) => message.role === "user");
  const uploadedFiles = userMessages.flatMap((message) => extractUploadedFilesFromText(message.text));
  const dedupedUploadedFiles = Array.from(
    new Map(uploadedFiles.map((file) => [file.fileName.toLowerCase(), file])).values()
  );

  const messages = baseMessages.map((message) => {
    const uploadSources =
      message.role === "assistant"
        ? collectReferencedUploads(message.text, dedupedUploadedFiles)
        : [];
    const sources =
      message.role === "assistant"
        ? mergeSources(message.webSources || [], uploadSources)
        : [];

    const { webSources, ...rest } = message;

    return {
      ...rest,
      sources,
      sourceCount: sources.length
    };
  });

  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const totalSourceCount = assistantMessages.reduce(
    (count, message) => count + message.sourceCount,
    0
  );
  const totalWebSourceCount = assistantMessages.reduce(
    (count, message) => count + message.sources.filter((source) => source.type === "web").length,
    0
  );
  const totalUploadReferenceCount = assistantMessages.reduce(
    (count, message) => count + message.sources.filter((source) => source.type === "upload").length,
    0
  );

  const payload = {
    schemaVersion: "1.0.0",
    platform: "chatgpt",
    extractedAt: new Date().toISOString(),
    conversation: {
      id: getConversationId(),
      url: window.location.href,
      title: getConversationTitle()
    },
    summary: {
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      uploadCount: dedupedUploadedFiles.length,
      totalSourceCount,
      totalWebSourceCount,
      totalUploadReferenceCount
    },
    uploadedFiles: dedupedUploadedFiles,
    messages,
    extractionErrors
  };

  console.log("[ChatGPT Extractor][Page] Extracted conversation payload:", payload);
  console.log(
    "[ChatGPT Extractor][Page] Extracted conversation payload JSON:\n" +
      JSON.stringify(payload, null, 2)
  );

  return payload;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    console.warn("[ChatGPT Extractor] No active tab id was found.");
    return;
  }

  if (!isChatGptConversationUrl(tab.url || "")) {
    console.warn("[ChatGPT Extractor] Open a ChatGPT conversation tab first.");
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: extractChatGptConversationFromPage
    });

    if (!result) {
      throw new Error("No extraction result was returned from the page.");
    }

    const backendResult = await sendChatPayloadToBackend(result);
    const highlightPayload = buildHighlightPayloadFromBackend(backendResult, result);
    const highlightingResult = await applyHighlightsInTab(tab.id, highlightPayload);
    const payload = {
      ...result,
      highlightPayload,
      highlighting: highlightingResult,
      backendForwarding: backendResult
    };
    const payloadJson = JSON.stringify(payload, null, 2);

    console.log("[ChatGPT Extractor] Extracted conversation payload:", payload);
    console.log("[ChatGPT Extractor] Extracted conversation payload JSON:\n" + payloadJson);
  } catch (error) {
    console.error("[ChatGPT Extractor] Extraction failed:", error);
  }
});
