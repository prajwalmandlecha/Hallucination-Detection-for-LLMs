(function attachClaudeExtractor() {

  function extractClaudeConversationFromPage() {
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
      return normalizeText(document.title.replace(/\s*[\\|]\s*Claude\s*$/i, "")) || null;
    }

    // ── Uploaded-file inference (same logic as ChatGPT) ───────────────────────

    function extractUploadedFilesFromText(text) {
      const fileNameMatches = normalizeText(text).match(
        /\b[^\\/:*?"<>|\n]+\.(pdf|docx?|pptx?|xlsx?|csv|txt)\b/gi
      );
      return Array.from(
        new Set((fileNameMatches || []).map(f => normalizeText(f)).filter(Boolean))
      ).map(fileName => ({
        fileName,
        displayName: normalizeText(fileName.replace(/\.[^.]+$/, "")),
        extension: fileName.split(".").pop()?.toLowerCase() || null
      }));
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

    // ── DOM helpers ───────────────────────────────────────────────────────────

    function keepOutermostNodes(nodes) {
      return nodes.filter(n => !nodes.some(o => o !== n && o.contains(n)));
    }

    function isVisibleElement(el) {
      if (!(el instanceof HTMLElement)) return false;
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    }

    function queryFirstMatch(selectors) {
      for (const sel of selectors) {
        try {
          const nodes = Array.from(document.querySelectorAll(sel));
          if (nodes.length) return keepOutermostNodes(nodes);
        } catch { /* skip */ }
      }
      return [];
    }

    const USER_TURN_SELECTORS = [
      '[data-testid="user-message"]',
      '[data-human-turn="true"]',
    ];

    const ASSISTANT_TURN_SELECTORS = [
      '[data-testid="assistant-message"]',
      '.font-claude-message',
      '[class*="font-claude-message"]',
      '[data-is-streaming]',
    ];

    function extractTurnText(node) {
      try {
        for (const sel of [".prose", "[class*='prose']", ".whitespace-pre-wrap", "[class*='whitespace-pre-wrap']", "p"]) {
          const el = node.querySelector(sel);
          if (el && isVisibleElement(el)) {
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

    function getDomId(node, role, roleIndex) {
      const c = [node.getAttribute("data-testid"), node.getAttribute("id"), node.getAttribute("data-message-id")]
        .map(v => normalizeText(v || "")).filter(Boolean);
      return c[0] || `${role}-${roleIndex}`;
    }

    function extractMessages() {
      const userNodes = queryFirstMatch(USER_TURN_SELECTORS);
      const assistantNodes = queryFirstMatch(ASSISTANT_TURN_SELECTORS);

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
        if (!isVisibleElement(node)) continue;
        const text = extractTurnText(node);
        if (!text) continue;
        const dk = `${role}:${text}`;
        if (seenTexts.has(dk)) continue;
        seenTexts.add(dk);
        const roleIndex = role === "user" ? userRoleIndex++ : assistantRoleIndex++;
        messages.push({
          index: globalIndex++, id: getDomId(node, role, roleIndex), role, roleIndex, text,
          webSources: []  // Claude DOM doesn't expose citation URLs
        });
      }

      if (!messages.length) {
        console.warn("[Claude Extractor][Page] Primary selectors found no messages. data-testids:",
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
    const totalUploadReferenceCount = assistantMessages.reduce((n, m) => n + m.sources.filter(s => s.type === "upload").length, 0);

    const payload = {
      schemaVersion: "1.0.0", platform: "claude",
      extractedAt: new Date().toISOString(),
      conversation: { id: getConversationId(), url: window.location.href, title: getConversationTitle() },
      summary: {
        messageCount: messages.length, userMessageCount: userMessages.length,
        assistantMessageCount: assistantMessages.length, pageCanvasDocumentCount: 0,
        uploadCount: uploadedFiles.length, totalSourceCount, totalWebSourceCount: 0, totalUploadReferenceCount
      },
      uploadedFiles, pageCanvasDocuments: [], messages, extractionErrors
    };

    console.log("[Claude Extractor][Page] Extracted conversation payload:", payload);
    console.log("[Claude Extractor][Page] JSON:\n" + JSON.stringify(payload, null, 2));
    return payload;
  }

  window.__hdExtractClaudeConversation = extractClaudeConversationFromPage;
})();
