(function attachChatGptExtractor() {

  // Extracts the live ChatGPT conversation from the rendered page DOM.
  function extractChatGptConversationFromPage() {
    const extractionErrors = [];

    // Captures recoverable extraction failures without aborting the full run.
    function recordExtractionError(step, error) {
      extractionErrors.push({
        step,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    // Normalizes text pulled from the DOM into a compact, stable format.
    function normalizeText(value) {
      return String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    }

    // Reads the conversation id from the ChatGPT URL.
    function getConversationId() {
      return window.location.pathname.match(/\/c\/([^/?#]+)/)?.[1] || null;
    }

    // Derives a cleaner conversation title from the document title.
    function getConversationTitle() {
      const rawTitle = document.title.replace(/\s*-\s*ChatGPT\s*$/i, "");
      const title = normalizeText(rawTitle);
      return title || null;
    }

    // Expands a message node to the containing turn element when possible.
    function getMessageScope(node) {
      return node.closest("article") || node;
    }

    // Finds the most likely text container inside a rendered message turn.
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

    // Extracts readable message text from a conversation turn.
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

    // Checks whether a candidate page element is actually visible to the user.
    function isVisibleElement(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }

    // Builds a best-effort title for a ChatGPT Canvas document region.
    function getCanvasDocumentTitle(element) {
      return (
        normalizeText(
          element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.getAttribute("data-testid") ||
            element.closest("[aria-label]")?.getAttribute("aria-label") ||
            element.closest("section, aside, div")?.querySelector("h1, h2, h3")?.textContent ||
            ""
        ) || null
      );
    }

    // Filters page elements down to likely ChatGPT Canvas editor content.
    function isLikelyCanvasDocumentElement(element, text) {
      if (!(element instanceof HTMLElement) || !text) {
        return false;
      }

      if (!isVisibleElement(element)) {
        return false;
      }

      if (element.closest("[data-message-author-role]")) {
        return false;
      }

      if (element.matches("textarea, input, button")) {
        return false;
      }

      if (element.closest("form")) {
        return false;
      }

      const descriptor = normalizeText(
        [
          element.tagName,
          element.className,
          element.getAttribute("data-testid"),
          element.getAttribute("aria-label"),
          element.getAttribute("role")
        ].join(" ")
      ).toLowerCase();

      const hasCanvasHint =
        descriptor.includes("canvas") ||
        descriptor.includes("prosemirror") ||
        descriptor.includes("editor") ||
        descriptor.includes("document");

      const hasStructuredText = text.length >= 80 && /[\n\t]/.test(text);

      return hasCanvasHint || (element.isContentEditable && hasStructuredText);
    }

    // Collects ChatGPT Canvas documents from one DOM root, such as the main document or an iframe.
    function collectCanvasDocumentsFromRoot(rootNode, source) {
      const selectors = [
        "[data-testid*='canvas' i]",
        "[aria-label*='canvas' i]",
        "[class*='canvas' i]",
        ".ProseMirror",
        "[contenteditable='true']",
        "[role='textbox']"
      ];
      const candidates = Array.from(rootNode.querySelectorAll(selectors.join(",")));
      const documents = [];
      const seen = new Set();

      for (const element of candidates) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }

        const text = normalizeText(element.innerText || element.textContent || "");
        if (!isLikelyCanvasDocumentElement(element, text)) {
          continue;
        }

        const dedupeKey = text.toLowerCase();
        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        documents.push({
          index: documents.length,
          type: "canvas_document",
          source,
          title: getCanvasDocumentTitle(element),
          text
        });
      }

      return documents;
    }

    // Finds ChatGPT Canvas documents that live outside normal assistant message bubbles.
    function collectPageCanvasDocuments() {
      const documents = collectCanvasDocumentsFromRoot(document, "document");

      for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
        try {
          const iframeDocument = iframe.contentDocument;
          if (!iframeDocument) {
            continue;
          }

          const iframeDocuments = collectCanvasDocumentsFromRoot(iframeDocument, "iframe");
          for (const item of iframeDocuments) {
            documents.push({
              ...item,
              index: documents.length
            });
          }
        } catch {
          continue;
        }
      }

      const seen = new Set();
      return documents.filter((item) => {
        const dedupeKey = item.text.toLowerCase();
        if (seen.has(dedupeKey)) {
          return false;
        }

        seen.add(dedupeKey);
        return true;
      });
    }

    // Chooses which assistant message should receive appended Canvas-document text.
    function resolveCanvasTargetMessage(messages, pageCanvasDocuments) {
      if (!pageCanvasDocuments.length) {
        return null;
      }

      const assistantMessages = messages.filter((message) => message.role === "assistant");
      if (!assistantMessages.length) {
        return null;
      }

      const explicitCanvasMessage = [...assistantMessages]
        .reverse()
        .find((message) => /\bcanvas\b/i.test(message.text));

      return explicitCanvasMessage || assistantMessages[assistantMessages.length - 1];
    }

    // Appends extracted ChatGPT Canvas-document content to the chosen assistant message.
    function appendCanvasDocumentsToMessage(message, pageCanvasDocuments) {
      if (!message || !pageCanvasDocuments.length) {
        return message;
      }

      const canvasAppendix = normalizeText(
        pageCanvasDocuments
          .map((item) =>
            normalizeText(
              `[Canvas Document ${item.index + 1}]${item.title ? ` ${item.title}` : ""}\n${item.text}`
            )
          )
          .join("\n\n")
      );
      const text = normalizeText([message.text, canvasAppendix].filter(Boolean).join("\n\n")) || null;

      return {
        ...message,
        text
      };
    }

    // Unwraps redirect-style URLs so sources point at the final external destination.
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

    // Keeps only external web URLs that are meaningful as citations.
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

    // Converts an anchor element into a normalized source record.
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

    // Collects and dedupes web sources referenced by one assistant turn.
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

    // Finds uploaded file names mentioned in user messages.
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

    // Infers uploaded files directly from user message text and records where they were attached.
    function inferUploadedFilesFromUserMessages(userMessages) {
      const byFileName = new Map();

      for (const message of userMessages || []) {
        const inferredFiles = extractUploadedFilesFromText(message.text);
        for (const file of inferredFiles) {
          const key = file.fileName.toLowerCase();
          const existing = byFileName.get(key) || {
            fileName: file.fileName,
            displayName: file.displayName,
            extension: file.extension,
            attachedInMessages: []
          };

          existing.attachedInMessages.push({
            messageIndex: message.index,
            messageId: message.id,
            roleIndex: message.roleIndex
          });

          byFileName.set(key, existing);
        }
      }

      return Array.from(byFileName.values()).map((file) => ({
        ...file,
        attachedInMessages: file.attachedInMessages.sort(
          (a, b) => (a.messageIndex || 0) - (b.messageIndex || 0)
        ),
        firstAttachedMessageIndex: file.attachedInMessages[0]?.messageIndex ?? null,
        attachmentMentions: file.attachedInMessages.length,
        source: "inferred_from_user_messages"
      }));
    }

    // Escapes plain text so it can be used inside file-reference regexes.
    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Maps assistant-message text back to uploaded files mentioned earlier in the chat.
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

    // Combines web and upload sources while preserving a single index sequence.
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

    // Builds a stable id for a message from DOM identifiers when available.
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

    // Extracts all rendered conversation turns into normalized message objects.
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

    const pageCanvasDocuments = collectPageCanvasDocuments();
    const extractedMessages = extractMessages();
    const canvasTargetMessage = resolveCanvasTargetMessage(extractedMessages, pageCanvasDocuments);
    const baseMessages = extractedMessages.map((message) =>
      canvasTargetMessage && message.id === canvasTargetMessage.id
        ? appendCanvasDocumentsToMessage(message, pageCanvasDocuments)
        : message
    );
    const userMessages = baseMessages.filter((message) => message.role === "user");
    const uploadedFiles = inferUploadedFilesFromUserMessages(userMessages);

    const messages = baseMessages.map((message) => {
      const uploadSources =
        message.role === "assistant"
          ? collectReferencedUploads(message.text, uploadedFiles)
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
        pageCanvasDocumentCount: pageCanvasDocuments.length,
        uploadCount: uploadedFiles.length,
        totalSourceCount,
        totalWebSourceCount,
        totalUploadReferenceCount
      },
      uploadedFiles,
      pageCanvasDocuments,
      messages,
      extractionErrors
    };

    console.log("[ChatGPT Extractor][Page] Extracted conversation payload:", payload);

    return payload;
  }

  window.__hdExtractChatGptConversation = extractChatGptConversationFromPage;
})();
