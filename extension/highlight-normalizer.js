(function attachHighlightNormalizer(globalScope) {
  // Normalizes text so matching and deduping are less sensitive to spacing.
  function normalizeComparisonText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  // Safely parses integer-like fields coming from backend responses.
  function toInteger(value) {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isInteger(parsedValue) ? parsedValue : null;
  }

  // Dedupes strings after normalizing them into a comparison-friendly form.
  function dedupeStrings(values) {
    return Array.from(
      new Set(
        (values || [])
          .map((value) => normalizeComparisonText(value))
          .filter(Boolean)
      )
    );
  }

  // Converts a citation-like value into a readable label for the tooltip.
  function formatCitation(value) {
    if (typeof value === "string") {
      return normalizeComparisonText(value);
    }

    if (!value || typeof value !== "object") {
      return null;
    }

    return (
      normalizeComparisonText(
        value.title ||
          value.fileName ||
          value.displayName ||
          value.name ||
          value.label ||
          value.url ||
          value.href ||
          ""
      ) || null
    );
  }

  // Collects citation labels across several backend field names.
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

  // Extracts a source snippet for tooltip display when the backend provides one.
  function normalizeSnippet(item) {
    function isAllowedSnippetSource(sourceType) {
      const normalizedSourceType = normalizeComparisonText(sourceType).toLowerCase();
      return normalizedSourceType !== "conversation_history";
    }

    const directSnippet = normalizeComparisonText(
      item?.snippet || item?.quote || item?.excerpt || item?.supporting_snippet || ""
    );
    const directSnippetSourceType = item?.source_type || item?.sourceType || "";

    if (directSnippet && isAllowedSnippetSource(directSnippetSourceType || "")) {
      return directSnippet;
    }

    const evidenceItems = Array.isArray(item?.verification_details?.evidence)
      ? item.verification_details.evidence
      : [];

    for (const evidence of evidenceItems) {
      const evidenceSourceType = evidence?.source_type || evidence?.sourceType || "";
      if (!isAllowedSnippetSource(evidenceSourceType)) {
        continue;
      }

      const evidenceSnippet = normalizeComparisonText(
        evidence?.snippet || evidence?.text || evidence?.excerpt || evidence?.quote || ""
      );
      if (evidenceSnippet) {
        return evidenceSnippet;
      }
    }

    return "";
  }

  function buildNumberedSourcesAndSnippets(item, citations) {
    function isAllowedSourceType(sourceType) {
      const normalized = normalizeComparisonText(sourceType).toLowerCase();
      return normalized && normalized !== "conversation_history";
    }

    const evidenceItems = Array.isArray(item?.verification_details?.evidence)
      ? item.verification_details.evidence
      : [];

    const sources = [];
    const seen = new Set();

    function addSource(label) {
      const normalizedLabel = normalizeComparisonText(label);
      if (!normalizedLabel) {
        return null;
      }

      const key = normalizedLabel.toLowerCase();
      const existingIndex = sources.findIndex((value) => value.toLowerCase() === key);
      if (existingIndex >= 0) {
        return existingIndex + 1;
      }

      if (sources.length >= 8) {
        return null;
      }

      if (seen.has(key)) {
        return null;
      }

      seen.add(key);
      sources.push(normalizedLabel);
      return sources.length;
    }

    for (const evidence of evidenceItems) {
      const evidenceSourceType = evidence?.source_type || evidence?.sourceType || "";
      if (!isAllowedSourceType(evidenceSourceType)) {
        continue;
      }

      const label = normalizeComparisonText(
        evidence?.source_title || evidence?.sourceTitle || evidence?.document_name || evidence?.documentName || evidence?.source_url || evidence?.sourceUrl || ""
      );
      addSource(label);
    }

    if (!sources.length) {
      for (const citation of citations || []) {
        addSource(citation);
      }
    }

    const snippets = [];
    for (const evidence of evidenceItems) {
      const evidenceSourceType = evidence?.source_type || evidence?.sourceType || "";
      if (!isAllowedSourceType(evidenceSourceType)) {
        continue;
      }

      const text = normalizeComparisonText(
        evidence?.snippet || evidence?.text || evidence?.excerpt || evidence?.quote || ""
      );
      if (!text) {
        continue;
      }

      const label = normalizeComparisonText(
        evidence?.source_title || evidence?.sourceTitle || evidence?.document_name || evidence?.documentName || evidence?.source_url || evidence?.sourceUrl || ""
      );
      const sourceNumber = addSource(label);

      snippets.push({
        sourceNumber: sourceNumber,
        text: text.slice(0, 260)
      });

      if (snippets.length >= 6) {
        break;
      }
    }

    return { sources, snippets };
  }

  // Carries forward message-targeting hints while walking nested response shapes.
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

  // Converts a raw backend item into a single normalized highlight candidate.
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

  // Pulls highlight-like arrays from a container using common backend keys.
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

  // Recursively searches the backend response for claim or highlight candidates.
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
      if (directItem && (directItem.statement || directItem.claim || directItem.sentence)) {
        items.push(directItem);
      }
      items.push(...collectHighlightEntries(container, targetHints));

      for (const key of ["data", "result", "results"]) {
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

  // Resolves which assistant message a highlight should be applied to.
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

    const inferredMatches = assistantMessages
      .filter((message) =>
        normalizeComparisonText(message.text).toLowerCase().includes(normalizedStatement)
      )
      .map((message) => message.roleIndex);

    if (inferredMatches.length) {
      return inferredMatches;
    }

    // Fallback: pin to the most-recent assistant message when the claim cannot be
    // attributed to a specific one. Returning ALL indices (old behaviour) caused the
    // same claim to be highlighted in every response in the conversation, which looked
    // very glitchy. The DOM highlighter's own container-fallback (dom.js) will
    // still broaden the search if the last-message container has no matching text.
    if (assistantMessages.length > 0) {
      const lastMsg = assistantMessages[assistantMessages.length - 1];
      console.debug(
        `[HighlightNormalizer] No message match for claim — pinning to last assistant ` +
        `(roleIndex=${lastMsg.roleIndex}): "${normalizedStatement.slice(0, 60)}..."`
      );
      return [lastMsg.roleIndex];
    }

    return [];
  }

  // Builds the final DOM highlighter payload from backend output plus extracted chat data.
  function buildHighlightPayloadFromBackend(backendResult, extractedConversation) {
    if (!backendResult?.ok || !backendResult.response) {
      return { items: [], summary: null };
    }

    const assistantMessages = (extractedConversation?.messages || []).filter(
      (message) => message.role === "assistant"
    );

    const syncNewMessageCount = toInteger(backendResult?.sync?.newMessageCount);
    const hasFreshMessages = syncNewMessageCount === null ? true : syncNewMessageCount > 0;
    const hasAssistantOutput = assistantMessages.length > 0;
    const responseClaims = Array.isArray(backendResult?.response?.claims)
      ? backendResult.response.claims
      : [];
    const responseMessageResults = Array.isArray(backendResult?.response?.results)
      ? backendResult.response.results
      : [];
    const extractedClaimCount = toInteger(backendResult?.response?.metadata?.claims_extracted) || 0;

    const hasHistoricalAnalysis =
      extractedClaimCount > 0 ||
      responseClaims.length > 0 ||
      responseMessageResults.some((messageResult) => {
        const claimCount = Array.isArray(messageResult?.claims)
          ? messageResult.claims.length
          : 0;
        return claimCount > 0;
      });

    // Avoid showing stale risk scores on reclick/zero-delta sync and on fresh chats
    // that don't have any assistant response yet.
    if (!hasAssistantOutput && !hasHistoricalAnalysis) {
      return {
        items: [],
        summary: {
          state: "idle",
          level: "PENDING",
          color: "#9CA3AF",
          message: "Waiting for an assistant response before analysis."
        },
        message_results: []
      };
    }

    if (!hasFreshMessages && !hasHistoricalAnalysis) {
      return {
        items: [],
        summary: {
          state: "idle",
          level: "PENDING",
          color: "#9CA3AF",
          message: "No new assistant response since the last run."
        },
        message_results: []
      };
    }

    const rawItems = collectHighlightCandidates(backendResult.response);
    const highlightItems = [];
    const seen = new Set();

    for (const item of rawItems) {
      const statement = normalizeComparisonText(
        item?.exact_quote || item?.statement || item?.claim || item?.sentence || item?.text || item?.content || ""
      );

      if (!statement) {
        continue;
      }

      const targetIndices = resolveAssistantRoleIndices(item, statement, assistantMessages);
      if (!targetIndices.length) {
        continue;
      }

      const score =
        item?.risk_score ??
        item?.score ??
        item?.riskScore ??
        item?.risk ??
        item?.hallucinationScore ??
        item?.confidence ??
        item?.probability ??
        "N/A";

      const status = item?.status || "UNVERIFIED";

      const note = normalizeComparisonText(
        item?.note ||
          item?.explanation ||
          item?.reason ||
          item?.summary ||
          item?.description ||
          "No details available."
      );

      const snippet = normalizeSnippet(item);

      const citations = normalizeCitations(item);

      const type = item?.domain || item?.type || "factual";
      const entailment_score = item?.verification_details?.entailment_score ?? null;
      const contradiction_score = item?.verification_details?.contradiction_score ?? null;
      const neutral_score = item?.verification_details?.neutral_score ?? null;
      const sources_checked = item?.verification_details?.sources_checked || [];
      const numbered = buildNumberedSourcesAndSnippets(item, citations);

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
          status: status,
          type: type,
          entailment_score: entailment_score,
          contradiction_score: contradiction_score,
          neutral_score: neutral_score,
          sources_checked: sources_checked.join(", "),
          citations,
          sources: numbered.sources,
          snippets: numbered.snippets,
          note,
          snippet
        });
      }
    }

    const summary = {
      score: backendResult.response.overall_risk_score ?? "N/A",
      level: backendResult.response.risk_level || "UNKNOWN",
      color: backendResult.response.risk_color || "#9CA3AF",
      message: backendResult.response.warning_message || "No warnings detected."
    };

    if (!hasFreshMessages && hasHistoricalAnalysis) {
      summary.state = "cached";
      summary.message = "Showing previous analysis for this conversation.";
    }

    return {
      items: highlightItems,
      summary: summary,
      message_results: backendResult.response.results || []
    };
  }

  globalScope.HighlightNormalizer = {
    buildHighlightPayloadFromBackend
  };
})(self);
