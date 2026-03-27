(function attachDeepSeekExtractor() {

  function extractDeepSeekConversationFromPage() {
    const extractionErrors = [];

    function recordExtractionError(step, error) {
      extractionErrors.push({ step, message: error instanceof Error ? error.message : String(error) });
    }

    function normalizeText(value) {
      return String(value || "")
        .replace(/\u00a0/g, " ").replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ").trim();
    }

    function getConversationId() {
      return window.location.pathname.match(/\/chat\/([^/?#]+)/)?.[1] || null;
    }

    function getConversationTitle() {
      return normalizeText(document.title.replace(/\s*[-–|]\s*DeepSeek\s*$/i, "")) || null;
    }

    function isVisibleElement(el) {
      if (!(el instanceof HTMLElement)) return false;
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    }

    function keepOutermostNodes(nodes) {
      return nodes.filter(n => !nodes.some(o => o !== n && o.contains(n)));
    }

    // ── Uploaded-file inference ───────────────────────────────────────────────

    function extractUploadedFilesFromText(text) {
      const m = normalizeText(text).match(/\b[^\\/:*?"<>|\n]+\.(pdf|docx?|pptx?|xlsx?|csv|txt)\b/gi);
      return Array.from(new Set((m || []).map(f => normalizeText(f)).filter(Boolean)))
        .map(fileName => ({ fileName, displayName: normalizeText(fileName.replace(/\.[^.]+$/, "")), extension: fileName.split(".").pop()?.toLowerCase() || null }));
    }

    function inferUploadedFilesFromUserMessages(userMessages) {
      const byFileName = new Map();
      for (const message of userMessages || []) {
        for (const file of extractUploadedFilesFromText(message.text)) {
          const key = file.fileName.toLowerCase();
          const existing = byFileName.get(key) || { ...file, attachedInMessages: [] };
          existing.attachedInMessages.push({ messageIndex: message.index, messageId: message.id, roleIndex: message.roleIndex });
          byFileName.set(key, existing);
        }
      }
      return Array.from(byFileName.values()).map(file => ({
        ...file,
        attachedInMessages: file.attachedInMessages.sort((a, b) => (a.messageIndex || 0) - (b.messageIndex || 0)),
        firstAttachedMessageIndex: file.attachedInMessages[0]?.messageIndex ?? null,
        attachmentMentions: file.attachedInMessages.length,
        source: "inferred_from_user_messages"
      }));
    }

    function escapeRegExp(v) { return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    function collectReferencedUploads(text, uploadedFiles) {
      const normalized = normalizeText(text);
      if (!normalized) return [];
      return uploadedFiles.filter(file =>
        [file.fileName, file.displayName].filter(Boolean).some(c =>
          new RegExp(`(^|\\b)${escapeRegExp(c)}(\\b|$)`, "i").test(normalized)
        )
      ).map((file, index) => ({
        index, type: "upload", title: file.fileName, fileName: file.fileName,
        displayName: file.displayName, extension: file.extension,
        url: null, host: null, citationLabel: null, rawUrl: null
      }));
    }

    function mergeSources(webSources, uploadSources) {
      const seen = new Set(); const merged = [];
      for (const s of [...webSources, ...uploadSources]) {
        const key = `${s.type}::${s.url || s.fileName || s.title || ""}`;
        if (!seen.has(key)) { seen.add(key); merged.push(s); }
      }
      return merged.map((s, i) => ({ ...s, index: i }));
    }

    // ── Source helpers ────────────────────────────────────────────────────────

    function unwrapExternalUrl(rawHref) {
      try {
        const u = new URL(rawHref, window.location.href);
        for (const p of ["url", "u", "target", "q"]) {
          const v = u.searchParams.get(p);
          if (v) { try { const n = new URL(v); if (/^https?:$/i.test(n.protocol)) return n.toString(); } catch { continue; } }
        }
        return u.toString();
      } catch { return null; }
    }

    function isSupportedSourceUrl(url) {
      try { const p = new URL(url); return /^https?:$/i.test(p.protocol) && !["chat.deepseek.com"].includes(p.hostname); } catch { return false; }
    }

    function buildSource(anchor) {
      const rawUrl = anchor.getAttribute("href") || "";
      const normalizedUrl = unwrapExternalUrl(rawUrl);
      if (!normalizedUrl || !isSupportedSourceUrl(normalizedUrl)) return null;
      let host = null;
      try { host = new URL(normalizedUrl).hostname; } catch { /* noop */ }
      const title = normalizeText(anchor.innerText || anchor.textContent || anchor.getAttribute("title") || anchor.getAttribute("aria-label") || "");
      const citationMatch = title.match(/^\[(\d+)\]$/);
      return { title: title || null, url: normalizedUrl, host, citationLabel: citationMatch ? citationMatch[1] : null, rawUrl: rawUrl && rawUrl !== normalizedUrl ? rawUrl : null };
    }

    function collectWebSources(node) {
      const seen = new Set(); const sources = [];
      for (const a of Array.from(node.querySelectorAll("a[href]"))) {
        const s = buildSource(a);
        if (!s) continue;
        const key = `${s.url}::${s.title || ""}`;
        if (!seen.has(key)) { seen.add(key); sources.push(s); }
      }
      return sources.map((s, i) => ({ ...s, type: "web", index: i }));
    }

    // ── DeepSeek DOM selectors ────────────────────────────────────────────────
    //
    // DeepSeek renders the chat in a scrollable div. User messages are
    // right-aligned in a container with a specific layout structure.
    // The assistant response (.ds-markdown) sits in a left-aligned container.
    //
    // Primary selectors target known stable class patterns.
    // Fallback: look for the outermost containers that alternate in the feed.

    function queryFirstMatch(selectors) {
      for (const sel of selectors) {
        try { const nodes = Array.from(document.querySelectorAll(sel)); if (nodes.length) return keepOutermostNodes(nodes); } catch { /* skip */ }
      }
      return [];
    }

    const USER_TURN_SELECTORS = [
      '[data-testid="user-message"]',
      '[class*="user-message"]',
      // DeepSeek user bubbles are right-aligned — look for flex row-reverse wrappers
      '.flex.flex-row-reverse',
      '[class*="human"]',
    ];

    const ASSISTANT_TURN_SELECTORS = [
      '[data-testid="assistant-message"]',
      '.ds-markdown',
      '[class*="ds-markdown"]',
      '[class*="markdown-body"]',
      // DeepSeek also uses a specific wrapper for the response area
      '[class*="content-area"]',
    ];

    function extractTurnText(node) {
      try {
        for (const sel of [".ds-markdown", "[class*='ds-markdown']", ".markdown-body", ".prose", "[class*='prose']", "p"]) {
          const el = node.querySelector(sel);
          if (el) {
            const t = normalizeText(el.innerText || el.textContent || "");
            if (t) return t;
          }
        }
        return normalizeText(node.innerText || node.textContent || "") || null;
      } catch (error) {
        recordExtractionError("extract_turn_text", error);
        return null;
      }
    }

    function extractMessages() {
      let userNodes = queryFirstMatch(USER_TURN_SELECTORS);
      let assistantNodes = queryFirstMatch(ASSISTANT_TURN_SELECTORS);

      // Fallback: if selectors didn't work, look for the chat feed children
      if (!userNodes.length && !assistantNodes.length) {
        const feed =
          document.querySelector('[class*="chat-area"]') ||
          document.querySelector('[class*="conversation"]') ||
          document.querySelector("main") ||
          document.body;

        const allDivs = keepOutermostNodes(
          Array.from(feed.querySelectorAll("div, article")).filter(el => {
            const t = normalizeText(el.innerText || "");
            return isVisibleElement(el) && t.length > 10;
          })
        );

        // Alternate heuristic
        allDivs.forEach((el, i) => {
          if (i % 2 === 0) userNodes.push(el); else assistantNodes.push(el);
        });
      }

      const allTurns = [
        ...userNodes.map(n => ({ node: n, role: "user" })),
        ...assistantNodes.map(n => ({ node: n, role: "assistant" }))
      ].sort((a, b) => {
        const pos = a.node.compareDocumentPosition(b.node);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      const messages = [];
      let globalIndex = 0, userRoleIndex = 0, assistantRoleIndex = 0;
      const seenNodes = new WeakSet(), seenTexts = new Set();

      for (const { node, role } of allTurns) {
        if (seenNodes.has(node)) continue;
        seenNodes.add(node);
        const text = extractTurnText(node);
        if (!text) continue;
        const dk = `${role}:${text}`;
        if (seenTexts.has(dk)) continue;
        seenTexts.add(dk);
        const roleIndex = role === "user" ? userRoleIndex++ : assistantRoleIndex++;
        messages.push({
          index: globalIndex++, id: `${role}-${roleIndex}`, role, roleIndex, text,
          webSources: role === "assistant" ? collectWebSources(node) : []
        });
      }

      if (!messages.length) {
        console.warn("[DeepSeek Extractor][Page] No messages found. data-testids:",
          Array.from(document.querySelectorAll("[data-testid]")).map(el => el.getAttribute("data-testid")).filter(Boolean).slice(0, 40)
        );
      }

      return messages;
    }

    // ── Build payload ─────────────────────────────────────────────────────────

    const rawMessages = extractMessages();
    const userMessages = rawMessages.filter(m => m.role === "user");
    const uploadedFiles = inferUploadedFilesFromUserMessages(userMessages);

    const messages = rawMessages.map(m => {
      const uploadSources = m.role === "assistant" ? collectReferencedUploads(m.text, uploadedFiles) : [];
      const sources = m.role === "assistant" ? mergeSources(m.webSources || [], uploadSources) : [];
      const { webSources, ...rest } = m;
      return { ...rest, sources, sourceCount: sources.length };
    });

    const assistantMessages = messages.filter(m => m.role === "assistant");
    const totalSourceCount = assistantMessages.reduce((n, m) => n + m.sourceCount, 0);
    const totalWebSourceCount = assistantMessages.reduce((n, m) => n + m.sources.filter(s => s.type === "web").length, 0);
    const totalUploadReferenceCount = assistantMessages.reduce((n, m) => n + m.sources.filter(s => s.type === "upload").length, 0);

    const payload = {
      schemaVersion: "1.0.0", platform: "deepseek",
      extractedAt: new Date().toISOString(),
      conversation: { id: getConversationId(), url: window.location.href, title: getConversationTitle() },
      summary: {
        messageCount: messages.length, userMessageCount: userMessages.length,
        assistantMessageCount: assistantMessages.length, pageCanvasDocumentCount: 0,
        uploadCount: uploadedFiles.length, totalSourceCount, totalWebSourceCount, totalUploadReferenceCount
      },
      uploadedFiles, pageCanvasDocuments: [], messages, extractionErrors
    };

    console.log("[DeepSeek Extractor][Page] Extracted conversation payload:", payload);
    console.log("[DeepSeek Extractor][Page] JSON:\n" + JSON.stringify(payload, null, 2));
    return payload;
  }

  window.__hdExtractDeepSeekConversation = extractDeepSeekConversationFromPage;
})();
