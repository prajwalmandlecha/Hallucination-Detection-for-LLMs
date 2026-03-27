importScripts("highlight-normalizer.js");

const BACKEND_CHAT_URL = "";
const BACKEND_ATTACHMENT_URL = "http://127.0.0.1:5051/upload";
const EXTENSION_BUILD_TAG = "attachment-background-v2";

const CHATGPT_URL_PREFIXES = [
  "https://chatgpt.com/",
  "https://chat.openai.com/"
];
const CHAT_SYNC_STORAGE_PREFIX = "chat_sync_state::";

console.log("[ChatGPT Extractor] Background service worker booted:", {
  build: EXTENSION_BUILD_TAG,
  uploadUrl: BACKEND_ATTACHMENT_URL
});

function base64ToUint8Array(base64Value) {
  const binary = atob(base64Value || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getConversationSyncKey(payload) {
  return payload?.conversation?.id || payload?.conversation?.url || null;
}

function getConversationStorageKey(conversationKey) {
  return `${CHAT_SYNC_STORAGE_PREFIX}${conversationKey}`;
}

async function getConversationSyncState(conversationKey) {
  if (!conversationKey) {
    return null;
  }

  const storageKey = getConversationStorageKey(conversationKey);
  const storedValue = await chrome.storage.local.get(storageKey);
  return storedValue?.[storageKey] || null;
}

async function setConversationSyncState(conversationKey, syncState) {
  if (!conversationKey) {
    return;
  }

  const storageKey = getConversationStorageKey(conversationKey);
  await chrome.storage.local.set({
    [storageKey]: syncState
  });
}

function filterUploadedFilesByMessages(uploadedFiles, messages) {
  const allowedMessageIds = new Set((messages || []).map((message) => message.id));

  return (uploadedFiles || []).filter((file) =>
    (file?.attachedInMessages || []).some((item) => allowedMessageIds.has(item?.messageId))
  );
}

function buildIncrementalChatPayload(payload, syncState, conversationKey) {
  const allMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const lastSyncedMessageId = syncState?.lastMessageId || null;
  const matchedIndex = lastSyncedMessageId
    ? allMessages.findIndex((message) => message.id === lastSyncedMessageId)
    : -1;
  const startIndex = matchedIndex >= 0 ? matchedIndex + 1 : 0;
  const newMessages = allMessages.slice(startIndex);
  const uploadedFiles = filterUploadedFilesByMessages(payload?.uploadedFiles, newMessages);
  const userMessageCount = newMessages.filter((message) => message.role === "user").length;
  const assistantMessageCount = newMessages.filter((message) => message.role === "assistant").length;
  const totalSourceCount = newMessages.reduce(
    (count, message) => count + (message?.sourceCount || 0),
    0
  );
  const totalWebSourceCount = newMessages.reduce(
    (count, message) =>
      count + (message?.sources || []).filter((source) => source.type === "web").length,
    0
  );
  const totalUploadReferenceCount = newMessages.reduce(
    (count, message) =>
      count + (message?.sources || []).filter((source) => source.type === "upload").length,
    0
  );
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
          syncedAt: new Date().toISOString()
        }
      : syncState
  };
}

// Checks whether the active tab points at a supported ChatGPT page.
function isChatGptConversationUrl(url) {
  return CHATGPT_URL_PREFIXES.some((prefix) => (url || "").startsWith(prefix));
}

// Uploads a captured ChatGPT attachment from the extension service worker.
async function uploadAttachmentToBackend(uploadRequest) {
  if (!BACKEND_ATTACHMENT_URL) {
    return {
      attempted: false,
      reason: "BACKEND_ATTACHMENT_URL is not configured."
    };
  }

  const metadata = uploadRequest?.metadata || {};
  const conversation = metadata.conversation || {};
  const fileData = uploadRequest?.fileData || {};

  if (!fileData.base64) {
    return {
      attempted: true,
      ok: false,
      status: "missing_file_data",
      error: "No serialized file data was provided."
    };
  }

  try {
    const fileBytes = base64ToUint8Array(fileData.base64);
    const fileBlob = new Blob([fileBytes], {
      type: fileData.type || "application/octet-stream"
    });
    const formData = new FormData();

    formData.append("file", fileBlob, fileData.name || "upload.bin");
    formData.append("platform", conversation.platform || "chatgpt");
    formData.append("capture_source", metadata.source || "unknown");

    if (conversation.id) {
      formData.append("external_conversation_id", conversation.id);
    }

    if (conversation.url) {
      formData.append("conversation_url", conversation.url);
    }

    if (conversation.title) {
      formData.append("conversation_title", conversation.title);
    }

    const response = await fetch(BACKEND_ATTACHMENT_URL, {
      method: "POST",
      body: formData
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

// Handles background-side messages from persistent ChatGPT observers.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "chatgpt_background_ping") {
    sendResponse({
      ok: true,
      build: EXTENSION_BUILD_TAG,
      uploadUrl: BACKEND_ATTACHMENT_URL
    });
    return false;
  }

  if (message?.type === "chatgpt_get_attachment_upload_config") {
    sendResponse({
      backendAttachmentUrl: BACKEND_ATTACHMENT_URL
    });
    return false;
  }

  if (message?.type === "chatgpt_attachment_captured") {
    console.log("[ChatGPT Extractor] Attachment capture event:", {
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
      console.log("[ChatGPT Extractor] Background upload result:", {
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

// Injects the page extractor and returns the structured conversation payload.
async function extractConversationFromTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    files: ["chatgpt-extractor.js"]
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: () => {
      if (typeof window.__hdExtractChatGptConversation !== "function") {
        return {
          ok: false,
          reason: "Extractor entrypoint was not found in page context."
        };
      }

      return {
        ok: true,
        payload: window.__hdExtractChatGptConversation()
      };
    }
  });

  if (!result?.ok) {
    throw new Error(result?.reason || "Extraction script did not return a payload.");
  }

  if (!result.payload) {
    throw new Error("No extraction payload was returned from the page.");
  }

  return result.payload;
}

// Sends the extracted payload to the optional backend for scoring or analysis.
async function sendChatPayloadToBackend(payload) {
  const conversationKey = getConversationSyncKey(payload);
  const syncState = await getConversationSyncState(conversationKey);
  const preparedPayload = buildIncrementalChatPayload(payload, syncState, conversationKey);

  console.log("[ChatGPT Extractor] Prepared chat payload to send:", preparedPayload.payload);

  if (!preparedPayload.payload.messages.length) {
    return {
      attempted: false,
      reason: "No new messages were found for this conversation.",
      sync: preparedPayload.payload.incrementalSync,
      preparedPayload: preparedPayload.payload
    };
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preparedPayload.payload)
    });

    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
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

// Injects the DOM highlighter and applies the normalized highlight payload.
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

// Mirrors a debug payload into the ChatGPT tab console for easier inspection.
async function logDebugPayloadInTab(tabId, label, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (logLabel, logPayload) => {
      console.log(logLabel, logPayload);
    },
    args: [label, payload]
  });
}

// Runs the full extract -> backend -> normalize -> highlight pipeline on click.
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
    const extractedConversation = await extractConversationFromTab(tab.id);
    const backendResult = await sendChatPayloadToBackend(extractedConversation);
    await logDebugPayloadInTab(
      tab.id,
      "[ChatGPT Extractor][Page] Prepared chat payload to send:",
      backendResult?.preparedPayload || null
    );
    const highlightPayload = HighlightNormalizer.buildHighlightPayloadFromBackend(
      backendResult,
      extractedConversation
    );
    const highlightingResult = await applyHighlightsInTab(tab.id, highlightPayload);
    const payload = {
      ...extractedConversation,
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
