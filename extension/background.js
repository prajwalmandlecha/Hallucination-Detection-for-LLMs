importScripts("highlight-normalizer.js");

const BACKEND_CHAT_URL = "";

const CHATGPT_URL_PREFIXES = [
  "https://chatgpt.com/",
  "https://chat.openai.com/"
];

// Checks whether the active tab points at a supported ChatGPT page.
function isChatGptConversationUrl(url) {
  return CHATGPT_URL_PREFIXES.some((prefix) => (url || "").startsWith(prefix));
}

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
