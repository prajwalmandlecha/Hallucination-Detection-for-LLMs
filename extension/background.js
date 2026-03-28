importScripts("highlight-normalizer.js");

const BACKEND_CHAT_URL = "http://127.0.0.1:8000/api/v1/detect";
const BACKEND_ATTACHMENT_URL = "http://127.0.0.1:8000/api/v1/documents/upload";
const EXTENSION_BUILD_TAG = "multi-platform-v3";
const CHAT_SYNC_STORAGE_PREFIX = "chat_sync_state::";
const AUTO_RUN_ON_TAB_REFRESH = false;

// ── Platform URL prefix → platform key mapping ────────────────────────────────
const PLATFORM_URL_PREFIXES = {
  chatgpt: ["https://chatgpt.com/", "https://chat.openai.com/"],
  gemini: ["https://gemini.google.com/"],
  claude: ["https://claude.ai/"],
  deepseek: ["https://chat.deepseek.com/"]
};

// ── Per-platform extractor file name + window function name ───────────────────
const PLATFORM_EXTRACTORS = {
  chatgpt: { file: "chatgpt-extractor.js", fn: "__hdExtractChatGptConversation" },
  gemini: { file: "gemini-extractor.js", fn: "__hdExtractGeminiConversation" },
  claude: { file: "claude-extractor.js", fn: "__hdExtractClaudeConversation" },
  deepseek: { file: "deepseek-extractor.js", fn: "__hdExtractDeepSeekConversation" }
};

console.log("[AI Chat Extractor] Background service worker booted:", {
  build: EXTENSION_BUILD_TAG,
  uploadUrl: BACKEND_ATTACHMENT_URL
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function base64ToUint8Array(base64Value) {
  const binary = atob(base64Value || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Returns the platform key for a given URL, or null if unsupported.
function getSupportedPlatform(url) {
  for (const [platform, prefixes] of Object.entries(PLATFORM_URL_PREFIXES)) {
    if (prefixes.some((prefix) => (url || "").startsWith(prefix))) {
      return platform;
    }
  }
  return null;
}

// ── Incremental sync (chrome.storage) ─────────────────────────────────────────

function getConversationSyncKey(payload) {
  const normalizePart = (value, maxLength = 180) =>
    String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);

  const platform = normalizePart(payload?.platform || "unknown", 40);
  const conversationId = normalizePart(payload?.conversation?.id, 160);
  if (conversationId) {
    return `${platform}::id::${conversationId}`;
  }

  const normalizeUrl = (rawUrl) => {
    try {
      const parsedUrl = new URL(rawUrl);
      const stableParams = ["conversationId", "chatId", "threadId", "convId", "id"];
      const reducedParams = new URLSearchParams();

      for (const param of stableParams) {
        const value = parsedUrl.searchParams.get(param);
        if (value) {
          reducedParams.set(param, value);
        }
      }

      const query = reducedParams.toString();
      return `${parsedUrl.origin}${parsedUrl.pathname}${query ? `?${query}` : ""}`.toLowerCase();
    } catch {
      return normalizePart(rawUrl, 240);
    }
  };

  const conversationUrl = normalizeUrl(payload?.conversation?.url || "");
  const conversationTitle = normalizePart(payload?.conversation?.title, 120);
  const messageList = Array.isArray(payload?.messages) ? payload.messages : [];
  const fingerprintSource =
    messageList.find((message) => typeof message?.text === "string" && message.text.trim())?.text || "";
  const messageFingerprint = fingerprintSource
    ? `${messageList.length}:${normalizePart(fingerprintSource, 80)}`
    : `${messageList.length}:empty`;

  if (conversationUrl && conversationTitle) {
    return `${platform}::url_title::${conversationUrl}::${conversationTitle}`;
  }

  if (conversationUrl) {
    return `${platform}::url::${conversationUrl}::${messageFingerprint}`;
  }

  if (conversationTitle) {
    return `${platform}::title::${conversationTitle}::${messageFingerprint}`;
  }

  return null;
}

function getConversationStorageKey(conversationKey) {
  return `${CHAT_SYNC_STORAGE_PREFIX}${conversationKey}`;
}

async function getConversationSyncState(conversationKey) {
  if (!conversationKey) return null;
  const storageKey = getConversationStorageKey(conversationKey);
  const stored = await chrome.storage.local.get(storageKey);
  return stored?.[storageKey] || null;
}

async function setConversationSyncState(conversationKey, syncState) {
  if (!conversationKey) return;
  const storageKey = getConversationStorageKey(conversationKey);
  await chrome.storage.local.set({ [storageKey]: syncState });
}

function filterUploadedFilesByMessages(uploadedFiles, messages) {
  const allowedMessageIds = new Set((messages || []).map((m) => m.id));
  return (uploadedFiles || []).filter((file) =>
    (file?.attachedInMessages || []).some((item) => allowedMessageIds.has(item?.messageId))
  );
}

function buildIncrementalChatPayload(payload, syncState, conversationKey) {
  const allMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const lastSyncedMessageId = syncState?.lastMessageId || null;
  const matchedIndex = lastSyncedMessageId
    ? allMessages.findIndex((m) => m.id === lastSyncedMessageId)
    : -1;
  const startIndex = matchedIndex >= 0 ? matchedIndex + 1 : 0;
  const newMessages = allMessages.slice(startIndex);
  const uploadedFiles = filterUploadedFilesByMessages(payload?.uploadedFiles, newMessages);
  const userMessageCount = newMessages.filter((m) => m.role === "user").length;
  const assistantMessageCount = newMessages.filter((m) => m.role === "assistant").length;
  const totalSourceCount = newMessages.reduce((n, m) => n + (m?.sourceCount || 0), 0);
  const totalWebSourceCount = newMessages.reduce((n, m) => n + (m?.sources || []).filter((s) => s.type === "web").length, 0);
  const totalUploadReferenceCount = newMessages.reduce((n, m) => n + (m?.sources || []).filter((s) => s.type === "upload").length, 0);
  const lastMessage = allMessages[allMessages.length - 1] || null;

  return {
    payload: {
      ...payload,
      summary: {
        ...payload.summary,
        messageCount: newMessages.length,
        userMessageCount,
        assistantMessageCount,
        uploadCount: uploadedFiles.length,
        totalSourceCount,
        totalWebSourceCount,
        totalUploadReferenceCount,
        fullMessageCount: allMessages.length
      },
      uploadedFiles,
      messages: newMessages,
      incrementalSync: {
        enabled: true,
        conversationKey,
        lastSyncedMessageId,
        fullMessageCount: allMessages.length,
        newMessageCount: newMessages.length,
        startIndex
      }
    },
    nextSyncState: lastMessage
      ? {
          lastMessageId: lastMessage.id,
          lastMessageIndex: lastMessage.index,
          fullMessageCount: allMessages.length,
          syncedAt: new Date().toISOString()
        }
      : {
          ...(syncState || {}),
          fullMessageCount: allMessages.length,
          syncedAt: new Date().toISOString()
        }
  };
}

function isEmptyBackendDetectionResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") {
    return true;
  }

  const claims = Array.isArray(responseBody?.claims) ? responseBody.claims : [];
  const results = Array.isArray(responseBody?.results) ? responseBody.results : [];
  return claims.length === 0 && results.length === 0;
}

// ── File upload to Express server ─────────────────────────────────────────────

async function uploadAttachmentToBackend(uploadRequest) {
  if (!BACKEND_ATTACHMENT_URL) {
    return { attempted: false, reason: "BACKEND_ATTACHMENT_URL is not configured." };
  }

  const metadata = uploadRequest?.metadata || {};
  const conversation = metadata.conversation || {};
  const fileData = uploadRequest?.fileData || {};

  if (!fileData.base64) {
    return { attempted: true, ok: false, status: "missing_file_data", error: "No serialized file data was provided." };
  }

  try {
    const fileBytes = base64ToUint8Array(fileData.base64);
    const fileBlob = new Blob([fileBytes], { type: fileData.type || "application/octet-stream" });
    const formData = new FormData();

    formData.append("file", fileBlob, fileData.name || "upload.bin");
    formData.append("platform", conversation.platform || "unknown");
    formData.append("capture_source", metadata.source || "unknown");
    if (conversation.id) formData.append("external_conversation_id", conversation.id);
    if (conversation.url) formData.append("conversation_url", conversation.url);
    if (conversation.title) formData.append("conversation_title", conversation.title);

    const response = await fetch(BACKEND_ATTACHMENT_URL, { method: "POST", body: formData });
    let responseBody = null;
    try { responseBody = await response.json(); } catch { /* noop */ }

    return { attempted: true, ok: response.ok, status: response.status, response: responseBody };
  } catch (error) {
    return { attempted: true, ok: false, status: "network_error", error: String(error) };
  }
}

// ── Message listener (all platforms share chatgpt_* message types) ────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "chatgpt_background_ping") {
    sendResponse({ ok: true, build: EXTENSION_BUILD_TAG, uploadUrl: BACKEND_ATTACHMENT_URL });
    return false;
  }

  if (message?.type === "chatgpt_get_attachment_upload_config") {
    sendResponse({ backendAttachmentUrl: BACKEND_ATTACHMENT_URL });
    return false;
  }

  if (message?.type === "chatgpt_attachment_captured") {
    console.log("[AI Chat Extractor] Attachment captured:", {
      tabId: sender.tab?.id || null,
      url: sender.tab?.url || null,
      payload: message.payload || null
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "chatgpt_upload_attachment") {
    void (async () => {
      const result = await uploadAttachmentToBackend(message.payload);
      console.log("[AI Chat Extractor] Upload result:", {
        tabId: sender.tab?.id || null,
        url: sender.tab?.url || null,
        result
      });
      sendResponse(result);
    })();
    return true;
  }

  return false;
});

// ── Conversation extraction (platform-aware) ──────────────────────────────────

async function extractConversationFromTab(tabId, platform) {
  const extractor = PLATFORM_EXTRACTORS[platform];
  if (!extractor) {
    throw new Error(`No extractor registered for platform: ${platform}`);
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: [extractor.file]
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (fnName) => {
      if (typeof window[fnName] !== "function") {
        return { ok: false, reason: `Extractor '${fnName}' not found in page context.` };
      }
      return { ok: true, payload: window[fnName]() };
    },
    args: [extractor.fn]
  });

  if (!result?.ok) throw new Error(result?.reason || "Extraction did not return a payload.");
  if (!result.payload) throw new Error("No extraction payload was returned from the page.");
  return result.payload;
}

// ── Backend forwarding (with incremental sync) ────────────────────────────────

async function sendChatPayloadToBackend(payload, platform) {
  const conversationKey = getConversationSyncKey(payload);
  const syncState = await getConversationSyncState(conversationKey);
  const preparedPayload = buildIncrementalChatPayload(payload, syncState, conversationKey);
  const label = `[AI Chat Extractor][${platform}] Prepared chat payload to send:`;

  console.log(label, preparedPayload.payload);

  if (!preparedPayload.payload.messages.length) {
    console.log("[AI Chat Extractor] No new messages for this conversation, checking for past validations...");
  }

  if (!BACKEND_CHAT_URL) {
    await setConversationSyncState(conversationKey, preparedPayload.nextSyncState);
    return {
      attempted: false,
      reason: "BACKEND_CHAT_URL is not configured.",
      sync: preparedPayload.payload.incrementalSync,
      preparedPayload: preparedPayload.payload,
      advancedWithoutBackend: true

    };
  }

  try {
    const response = await fetch(BACKEND_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preparedPayload.payload)
    });

    let responseBody = null;
    try { responseBody = await response.json(); } catch { /* noop */ }

    const hasNoNewMessages = !preparedPayload.payload.messages.length;
    const hasExtractedMessages = Array.isArray(payload?.messages) && payload.messages.length > 0;
    const previousFullCount = Number(syncState?.fullMessageCount || 0);
    const currentFullCount = Array.isArray(payload?.messages) ? payload.messages.length : 0;
    const hasHistoryExpansion =
      hasNoNewMessages &&
      hasExtractedMessages &&
      previousFullCount > 0 &&
      currentFullCount > previousFullCount;
    const shouldForceFullResync =
      response.ok &&
      hasNoNewMessages &&
      hasExtractedMessages &&
      (isEmptyBackendDetectionResponse(responseBody) || hasHistoryExpansion);

    if (shouldForceFullResync) {
      console.warn(
        "[AI Chat Extractor] Zero-delta sync needs full recovery; retrying with full conversation payload.",
        {
          platform,
          conversationKey,
          incrementalSync: preparedPayload.payload.incrementalSync,
          reason: hasHistoryExpansion ? "history_expanded" : "empty_backend_response"
        }
      );

      const forcedFullSync = buildIncrementalChatPayload(payload, null, conversationKey);
      const recoveryPayload = {
        ...forcedFullSync.payload,
        incrementalSync: {
          ...forcedFullSync.payload.incrementalSync,
          recoveryMode: hasHistoryExpansion ? "history_expanded_resync" : "force_full_resync"
        }
      };

      const recoveryResponse = await fetch(BACKEND_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recoveryPayload)
      });

      let recoveryBody = null;
      try { recoveryBody = await recoveryResponse.json(); } catch { /* noop */ }

      if (recoveryResponse.ok) {
        await setConversationSyncState(conversationKey, forcedFullSync.nextSyncState);
      }

      return {
        attempted: true,
        ok: recoveryResponse.ok,
        status: recoveryResponse.status,
        response: recoveryBody,
        sync: recoveryPayload.incrementalSync,
        preparedPayload: recoveryPayload,
        fallbackTriggered: true,
        initialAttempt: {
          status: response.status,
          response: responseBody,
          sync: preparedPayload.payload.incrementalSync
        }
      };
    }

    if (response.ok) {
      await setConversationSyncState(conversationKey, preparedPayload.nextSyncState);
    }

    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      response: responseBody,
      sync: preparedPayload.payload.incrementalSync,
      preparedPayload: preparedPayload.payload
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: "network_error",
      error: String(error),
      sync: preparedPayload.payload.incrementalSync,
      preparedPayload: preparedPayload.payload
    };
  }
}

// ── Highlighting (injects dom.js + applies highlights) ────────────────────────

async function applyHighlightsInTab(tabId, highlightItems) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["dom.js"] });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (payload) => {
      if (typeof window.__hdApplyHighlights !== "function") {
        return { ok: false, reason: "Highlighter entrypoint not found in page context." };
      }
      return { ok: true, ...window.__hdApplyHighlights(payload) };
    },
    args: [highlightItems]
  });

  return result;
}

// Mirrors a debug payload into the page console for easier inspection.
async function logDebugPayloadInTab(tabId, label, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (logLabel, logPayload) => { console.log(logLabel, logPayload); },
    args: [label, payload]
  });
}

// ── Extension icon click: full extract → sync → highlight pipeline ─────────────

async function runExtractionForTab(tab) {
  if (!tab?.id) {
    console.warn("[AI Chat Extractor] No active tab id found.");
    return;
  }

  const platform = getSupportedPlatform(tab.url || "");
  if (!platform) {
    console.warn("[AI Chat Extractor] Unsupported tab. Open ChatGPT, Gemini, Claude, or DeepSeek conversation first.");
    return;
  }

  try {
    const extractedConversation = await extractConversationFromTab(tab.id, platform);
    const backendResult = await sendChatPayloadToBackend(extractedConversation, platform);

    await logDebugPayloadInTab(
      tab.id,
      `[AI Chat Extractor][${platform}] Prepared chat payload to send:`,
      backendResult?.preparedPayload || null
    );

    const highlightPayload = HighlightNormalizer.buildHighlightPayloadFromBackend(backendResult, extractedConversation);
    const highlightingResult = await applyHighlightsInTab(tab.id, highlightPayload);

    const payload = {
      ...extractedConversation,
      highlightPayload,
      highlighting: highlightingResult,
      backendForwarding: backendResult
    };

    console.log(`[AI Chat Extractor][${platform}] Extracted conversation payload:`, payload);
    console.log(`[AI Chat Extractor][${platform}] JSON:\n` + JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error(`[AI Chat Extractor] Extraction failed for platform '${platform}':`, error);
  }
}

chrome.action.onClicked.addListener(runExtractionForTab);

if (AUTO_RUN_ON_TAB_REFRESH) {
  const debounceTimers = {};
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" || changeInfo.url) {
      if (debounceTimers[tabId]) clearTimeout(debounceTimers[tabId]);
      debounceTimers[tabId] = setTimeout(() => {
        if (tab.url && getSupportedPlatform(tab.url)) {
          runExtractionForTab(tab);
        }
      }, 2500); // 2.5 second delay allows SPA frameworks (like Next.js on ChatGPT) to finish manipulating the DOM
    }
  });
}
