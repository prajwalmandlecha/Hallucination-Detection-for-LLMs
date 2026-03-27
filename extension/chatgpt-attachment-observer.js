(function attachChatGptAttachmentObserver() {
  if (window.__hdChatGptAttachmentObserverAttached) {
    return;
  }

  window.__hdChatGptAttachmentObserverAttached = true;
  const CONTENT_SCRIPT_BUILD_TAG = "attachment-observer-v2";

  const RECENT_CAPTURE_TTL_MS = 4000;
  const FILE_INPUT_SELECTOR = "input[type='file']";
  const wiredInputs = new WeakSet();
  const recentCaptureKeys = new Map();

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
    return normalizeText(rawTitle) || null;
  }

  function getConversationContext() {
    return {
      platform: "chatgpt",
      id: getConversationId(),
      url: window.location.href,
      title: getConversationTitle()
    };
  }

  function pruneRecentCaptureKeys(now) {
    for (const [key, timestamp] of recentCaptureKeys.entries()) {
      if (now - timestamp > RECENT_CAPTURE_TTL_MS) {
        recentCaptureKeys.delete(key);
      }
    }
  }

  function buildCaptureKey(file, conversationId) {
    return [
      conversationId || "draft",
      file.name || "",
      String(file.size || 0),
      String(file.lastModified || 0)
    ].join("::");
  }

  function shouldCaptureFile(file, conversationId) {
    const now = Date.now();
    const key = buildCaptureKey(file, conversationId);
    pruneRecentCaptureKeys(now);

    if (recentCaptureKeys.has(key)) {
      return false;
    }

    recentCaptureKeys.set(key, now);
    return true;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              __runtimeError: chrome.runtime.lastError.message || "Unknown runtime error"
            });
            return;
          }

          resolve(response || null);
        });
      } catch {
        resolve({
          __runtimeError: "Failed to call chrome.runtime.sendMessage"
        });
      }
    });
  }

  async function pingBackgroundServiceWorker() {
    const response = await sendRuntimeMessage({
      type: "chatgpt_background_ping"
    });

    console.log("[ChatGPT Extractor] Content script booted:", {
      build: CONTENT_SCRIPT_BUILD_TAG,
      background: response
    });
  }

  function uint8ArrayToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  async function serializeFileForBackgroundUpload(file) {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    return {
      name: file.name || "upload.bin",
      type: file.type || "application/octet-stream",
      size: Number.isFinite(file.size) ? file.size : bytes.length,
      base64: uint8ArrayToBase64(bytes)
    };
  }

  function buildAttachmentMetadata(file, source, conversation) {
    return {
      source,
      capturedAt: new Date().toISOString(),
      conversation,
      file: {
        name: file.name || null,
        type: file.type || null,
        size: Number.isFinite(file.size) ? file.size : null,
        lastModified: file.lastModified
          ? new Date(file.lastModified).toISOString()
          : null
      }
    };
  }

  function isTextLikeFile(file) {
    const mimeType = (file.type || "").toLowerCase();
    const fileName = (file.name || "").toLowerCase();

    if (mimeType.startsWith("text/")) {
      return true;
    }

    return [
      ".txt",
      ".md",
      ".json",
      ".csv",
      ".tsv",
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".html",
      ".css",
      ".xml",
      ".yml",
      ".yaml"
    ].some((extension) => fileName.endsWith(extension));
  }

  function toHexPreview(bytes, maxLength) {
    return Array.from(bytes.slice(0, maxLength))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
  }

  async function buildDebugPreview(file) {
    try {
      if (isTextLikeFile(file)) {
        const text = await file.text();
        const normalizedText = normalizeText(text);

        return {
          kind: "text",
          characterCount: text.length,
          preview: normalizedText.slice(0, 2000) || ""
        };
      }

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      return {
        kind: "binary",
        byteCount: bytes.length,
        previewHex: toHexPreview(bytes, 32)
      };
    } catch (error) {
      return {
        kind: "unavailable",
        error: String(error)
      };
    }
  }

  async function forwardAttachmentToBackend(file, metadata) {
    try {
      const fileData = await serializeFileForBackgroundUpload(file);
      const response = await sendRuntimeMessage({
        type: "chatgpt_upload_attachment",
        payload: {
          metadata,
          fileData
        }
      });

      if (response?.__runtimeError) {
        return {
          attempted: true,
          ok: false,
          status: "extension_error",
          error: response.__runtimeError
        };
      }

      if (!response) {
        return {
          attempted: true,
          ok: false,
          status: "extension_error",
          error: "No response was received from the background service worker."
        };
      }

      return response;
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        status: "serialization_error",
        error: String(error)
      };
    }
  }

  async function captureFiles(fileLikeList, source) {
    const files = Array.from(fileLikeList || []).filter((file) => file instanceof File);

    if (!files.length) {
      return;
    }

    const conversation = getConversationContext();

    for (const file of files) {
      if (!shouldCaptureFile(file, conversation.id)) {
        continue;
      }

      const metadata = buildAttachmentMetadata(file, source, conversation);
      const debugPreview = await buildDebugPreview(file);
      const backendForwarding = await forwardAttachmentToBackend(file, metadata);
      const payload = {
        ...metadata,
        debugPreview,
        backendForwarding
      };

      console.log("[ChatGPT Extractor] Captured ChatGPT attachment:", payload);

      await sendRuntimeMessage({
        type: "chatgpt_attachment_captured",
        payload
      });
    }
  }

  function wireFileInput(input) {
    if (!(input instanceof HTMLInputElement) || wiredInputs.has(input)) {
      return;
    }

    wiredInputs.add(input);
    input.addEventListener(
      "change",
      (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }

        void captureFiles(target.files, "file_input");
      },
      true
    );
  }

  function wireExistingFileInputs() {
    document.querySelectorAll(FILE_INPUT_SELECTOR).forEach((input) => wireFileInput(input));
  }

  const observer = new MutationObserver(() => {
    wireExistingFileInputs();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener(
    "drop",
    (event) => {
      if (event.dataTransfer?.files?.length) {
        void captureFiles(event.dataTransfer.files, "drag_and_drop");
      }
    },
    true
  );

  document.addEventListener(
    "paste",
    (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean);

      if (files.length) {
        void captureFiles(files, "paste");
      }
    },
    true
  );

  wireExistingFileInputs();
  void pingBackgroundServiceWorker();
})();
