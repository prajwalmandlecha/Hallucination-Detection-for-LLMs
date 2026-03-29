importScripts("highlight-normalizer.js");

const BACKEND_CHAT_URL = "http://127.0.0.1:8000/api/v1/detect";
const BACKEND_ATTACHMENT_URL = "http://127.0.0.1:8000/api/v1/documents/upload";
const EXTENSION_BUILD_TAG = "multi-platform-v3";
const CHAT_SYNC_STORAGE_PREFIX = "chat_sync_state::";
const TAB_CONVERSATION_STATE_STORAGE_PREFIX = "tab_conversation_state::";
const REAL_CONVERSATION_ALIAS_STORAGE_PREFIX = "real_conversation_alias::";
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

const PLATFORM_ATTACHMENT_OBSERVERS = {
  chatgpt: "chatgpt-attachment-observer.js",
  gemini: "gemini-attachment-observer.js",
  claude: "claude-attachment-observer.js",
  deepseek: "deepseek-attachment-observer.js"
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

function normalizeStoragePart(value, maxLength = 240) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeConversationId(value) {
  return normalizeStoragePart(value, 200);
}

function getTabConversationStateStorageKey(tabId) {
  return `${TAB_CONVERSATION_STATE_STORAGE_PREFIX}${tabId}`;
}

function getRealConversationAliasStorageKey(platform, realConversationId) {
  return `${REAL_CONVERSATION_ALIAS_STORAGE_PREFIX}${normalizeStoragePart(platform, 40)}::${normalizeConversationId(realConversationId)}`;
}

async function getTabConversationState(tabId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }

  const storageKey = getTabConversationStateStorageKey(tabId);
  const stored = await chrome.storage.local.get(storageKey);
  return stored?.[storageKey] || null;
}

async function setTabConversationState(tabId, state) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const storageKey = getTabConversationStateStorageKey(tabId);
  await chrome.storage.local.set({ [storageKey]: state });
}

async function clearTabConversationState(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const storageKey = getTabConversationStateStorageKey(tabId);
  await chrome.storage.local.remove(storageKey);
}

async function getRealConversationAlias(platform, realConversationId) {
  const normalizedConversationId = normalizeConversationId(realConversationId);
  if (!normalizedConversationId) {
    return null;
  }

  const storageKey = getRealConversationAliasStorageKey(platform, normalizedConversationId);
  const stored = await chrome.storage.local.get(storageKey);
  return stored?.[storageKey] || null;
}

async function setRealConversationAlias(platform, realConversationId, backendConversationId) {
  const normalizedConversationId = normalizeConversationId(realConversationId);
  const normalizedBackendConversationId = normalizeConversationId(backendConversationId);

  if (!normalizedConversationId || !normalizedBackendConversationId) {
    return;
  }

  const storageKey = getRealConversationAliasStorageKey(platform, normalizedConversationId);
  await chrome.storage.local.set({
    [storageKey]: {
      backendConversationId: normalizedBackendConversationId,
      mappedAt: new Date().toISOString()
    }
  });
}

function buildDraftBackendConversationId(platform) {
  return `draft::${normalizeStoragePart(platform || "unknown", 40) || "unknown"}::${crypto.randomUUID()}`;
}

function cloneSerializableData(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function clonePayloadWithBackendConversationId(payload, backendConversationId) {
  const clonedPayload = cloneSerializableData(payload);
  clonedPayload.conversation = {
    ...(clonedPayload.conversation || {}),
    id: backendConversationId || null
  };
  return clonedPayload;
}

async function resolveBackendConversationIdentity({ platform, conversation, tabId }) {
  const normalizedPlatform = normalizeStoragePart(platform || conversation?.platform || "unknown", 40) || "unknown";
  const realConversationId = normalizeConversationId(conversation?.id);
  const conversationUrl = conversation?.url || null;
  const nowIso = new Date().toISOString();

  if (realConversationId) {
    const storedAlias = await getRealConversationAlias(normalizedPlatform, realConversationId);
    if (storedAlias?.backendConversationId) {
      await setTabConversationState(tabId, {
        backendConversationId: storedAlias.backendConversationId,
        realConversationId,
        platform: normalizedPlatform,
        lastSeenUrl: conversationUrl,
        updatedAt: nowIso
      });

      return {
        backendConversationId: storedAlias.backendConversationId,
        realConversationId,
        platform: normalizedPlatform,
        usedAlias: storedAlias.backendConversationId !== realConversationId,
        isDraft: storedAlias.backendConversationId.startsWith("draft::")
      };
    }

    const tabState = await getTabConversationState(tabId);
    if (tabState?.backendConversationId && (!tabState.realConversationId || tabState.realConversationId === realConversationId)) {
      await setRealConversationAlias(normalizedPlatform, realConversationId, tabState.backendConversationId);
      await setTabConversationState(tabId, {
        ...tabState,
        realConversationId,
        platform: normalizedPlatform,
        lastSeenUrl: conversationUrl,
        updatedAt: nowIso
      });

      return {
        backendConversationId: tabState.backendConversationId,
        realConversationId,
        platform: normalizedPlatform,
        usedAlias: tabState.backendConversationId !== realConversationId,
        isDraft: tabState.backendConversationId.startsWith("draft::")
      };
    }

    await setTabConversationState(tabId, {
      backendConversationId: realConversationId,
      realConversationId,
      platform: normalizedPlatform,
      lastSeenUrl: conversationUrl,
      updatedAt: nowIso
    });

    return {
      backendConversationId: realConversationId,
      realConversationId,
      platform: normalizedPlatform,
      usedAlias: false,
      isDraft: false
    };
  }

  const tabState = await getTabConversationState(tabId);
  if (tabState?.backendConversationId && !tabState.realConversationId) {
    await setTabConversationState(tabId, {
      ...tabState,
      platform: normalizedPlatform,
      lastSeenUrl: conversationUrl,
      updatedAt: nowIso
    });

    return {
      backendConversationId: tabState.backendConversationId,
      realConversationId: null,
      platform: normalizedPlatform,
      usedAlias: true,
      isDraft: true
    };
  }

  const draftConversationId = buildDraftBackendConversationId(normalizedPlatform);
  await setTabConversationState(tabId, {
    backendConversationId: draftConversationId,
    realConversationId: null,
    platform: normalizedPlatform,
    lastSeenUrl: conversationUrl,
    createdAt: nowIso,
    updatedAt: nowIso
  });

  return {
    backendConversationId: draftConversationId,
    realConversationId: null,
    platform: normalizedPlatform,
    usedAlias: true,
    isDraft: true
  };
}

function extractConversationIdFromUrl(url, platform) {
  if (!url || platform !== "chatgpt") {
    return null;
  }

  return url.match(/\/c\/([^/?#]+)/)?.[1] || null;
}

async function promoteTabConversationAliasFromUrl(tabId, url) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const platform = getSupportedPlatform(url || "");
  const realConversationId = extractConversationIdFromUrl(url, platform);
  if (!platform || !realConversationId) {
    return;
  }

  const normalizedPlatform = normalizeStoragePart(platform, 40) || "unknown";
  const normalizedRealConversationId = normalizeConversationId(realConversationId);
  const nowIso = new Date().toISOString();
  const existingAlias = await getRealConversationAlias(normalizedPlatform, normalizedRealConversationId);

  if (existingAlias?.backendConversationId) {
    await setTabConversationState(tabId, {
      backendConversationId: existingAlias.backendConversationId,
      realConversationId: normalizedRealConversationId,
      platform: normalizedPlatform,
      lastSeenUrl: url,
      updatedAt: nowIso
    });
    return;
  }

  const tabState = await getTabConversationState(tabId);
  if (tabState?.backendConversationId && !tabState.realConversationId) {
    await setRealConversationAlias(normalizedPlatform, normalizedRealConversationId, tabState.backendConversationId);
    await setTabConversationState(tabId, {
      ...tabState,
      realConversationId: normalizedRealConversationId,
      platform: normalizedPlatform,
      lastSeenUrl: url,
      updatedAt: nowIso
    });

    console.log("[AI Chat Extractor] Promoted draft conversation alias:", {
      tabId,
      platform: normalizedPlatform,
      realConversationId: normalizedRealConversationId,
      backendConversationId: tabState.backendConversationId
    });
    return;
  }

  await setTabConversationState(tabId, {
    backendConversationId: normalizedRealConversationId,
    realConversationId: normalizedRealConversationId,
    platform: normalizedPlatform,
    lastSeenUrl: url,
    updatedAt: nowIso
  });
}

// ── Incremental sync (chrome.storage) ─────────────────────────────────────────

function getConversationSyncKey(payload) {
  const normalizePart = (value, maxLength = 180) => normalizeStoragePart(value, maxLength);

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

async function uploadAttachmentToBackend(uploadRequest, senderTab) {
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
    const resolvedConversation = await resolveBackendConversationIdentity({
      platform: conversation.platform,
      conversation,
      tabId: senderTab?.id
    });

    const fileBytes = base64ToUint8Array(fileData.base64);
    const fileBlob = new Blob([fileBytes], { type: fileData.type || "application/octet-stream" });
    const formData = new FormData();

    formData.append("file", fileBlob, fileData.name || "upload.bin");
    formData.append("platform", resolvedConversation.platform || conversation.platform || "unknown");
    formData.append("capture_source", metadata.source || "unknown");
    if (resolvedConversation.backendConversationId) {
      formData.append("external_conversation_id", resolvedConversation.backendConversationId);
    }
    if (conversation.url) formData.append("conversation_url", conversation.url);
    if (conversation.title) formData.append("conversation_title", conversation.title);

    const response = await fetch(BACKEND_ATTACHMENT_URL, { method: "POST", body: formData });
    let responseBody = null;
    try { responseBody = await response.json(); } catch { /* noop */ }

    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      response: responseBody,
      resolvedConversation
    };
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
      const result = await uploadAttachmentToBackend(message.payload, sender.tab);
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

async function ensureAttachmentObserverInTab(tabId, platform) {
  const observerFile = PLATFORM_ATTACHMENT_OBSERVERS[platform];
  if (!observerFile) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: [observerFile]
  });
}

// ── Backend forwarding (with incremental sync) ────────────────────────────────

async function sendChatPayloadToBackend(payload, platform, tabId) {
  const conversationKey = getConversationSyncKey(payload);
  const syncState = await getConversationSyncState(conversationKey);
  const resolvedConversation = await resolveBackendConversationIdentity({
    platform,
    conversation: payload?.conversation,
    tabId
  });
  const backendPayload = clonePayloadWithBackendConversationId(payload, resolvedConversation.backendConversationId);
  const preparedPayload = buildIncrementalChatPayload(backendPayload, syncState, conversationKey);
  const label = `[AI Chat Extractor][${platform}] Prepared chat payload to send:`;

  console.log(label, {
    resolvedConversation,
    payload: preparedPayload.payload
  });

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
      advancedWithoutBackend: true,
      resolvedConversation

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
    const hasExtractedMessages = Array.isArray(backendPayload?.messages) && backendPayload.messages.length > 0;
    const previousFullCount = Number(syncState?.fullMessageCount || 0);
    const currentFullCount = Array.isArray(backendPayload?.messages) ? backendPayload.messages.length : 0;
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

      const forcedFullSync = buildIncrementalChatPayload(backendPayload, null, conversationKey);
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
        resolvedConversation,
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
      preparedPayload: preparedPayload.payload,
      resolvedConversation
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: "network_error",
      error: String(error),
      sync: preparedPayload.payload.incrementalSync,
      preparedPayload: preparedPayload.payload,
      resolvedConversation
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

async function setDetectionStateInTab(tabId, statePayload) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["dom.js"] });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (payload) => {
      if (typeof window.__hdSetDetectionState !== "function") {
        return { ok: false, reason: "Detection state entrypoint not found." };
      }
      return window.__hdSetDetectionState(payload);
    },
    args: [statePayload]
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
    await setDetectionStateInTab(tab.id, {
      state: "loading",
      message: "Detecting hallucinations for the latest conversation context..."
    });

    await ensureAttachmentObserverInTab(tab.id, platform);
    const extractedConversation = await extractConversationFromTab(tab.id, platform);
    const backendResult = await sendChatPayloadToBackend(extractedConversation, platform, tab.id);

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
    try {
      await setDetectionStateInTab(tab.id, {
        state: "error",
        message: "Detection request failed. Please retry after checking backend status."
      });
    } catch (stateError) {
      console.warn("[AI Chat Extractor] Failed to render detection error state:", stateError);
    }

    console.error(`[AI Chat Extractor] Extraction failed for platform '${platform}':`, error);
  }
}

chrome.action.onClicked.addListener(runExtractionForTab);
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabConversationState(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const candidateUrl = changeInfo.url || tab?.url || "";
  if (candidateUrl) {
    void promoteTabConversationAliasFromUrl(tabId, candidateUrl);
  }
});

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
