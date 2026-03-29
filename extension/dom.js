(() => {
	const ROOT_ATTR = "data-hd-root";
	const HIGHLIGHT_CLASS = "hd-highlight";
	const TOOLTIP_ID = "hd-tooltip";
	const STYLE_ID = "hd-highlight-style";
	const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "MARK", "NOSCRIPT", "TEXTAREA"]);
	const SUMMARY_BANNER_ID = "hd-summary-banner";
	const NAV_WATCHER_KEY = "__hdNavWatcherBound";
	const DISMISS_KEY = "__hdSummaryDismissedUntilNavigation";
	const DISMISS_STORAGE_PREFIX = "hdSummaryDismissed:";

	function getDismissStorageKey() {
		return `${DISMISS_STORAGE_PREFIX}${window.location.origin}${window.location.pathname}`;
	}

	function isSummaryDismissed() {
		try {
			return window.localStorage.getItem(getDismissStorageKey()) === "1";
		} catch {
			return Boolean(window[DISMISS_KEY]);
		}
	}

	function setSummaryDismissed(value) {
		window[DISMISS_KEY] = Boolean(value);
		try {
			const key = getDismissStorageKey();
			if (value) {
				window.localStorage.setItem(key, "1");
			} else {
				window.localStorage.removeItem(key);
			}
		} catch {
			// Ignore storage failures (private mode, blocked storage, etc.)
		}
	}

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function safeParseJson(value, fallback) {
		if (!value) {
			return fallback;
		}
		try {
			return JSON.parse(value);
		} catch {
			return fallback;
		}
	}

	// Escapes user text so it can be used safely inside a RegExp.
	function escapeRegExp(value) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// Normalizes sentence text for matching and deduping.
	function normalizeSentence(value) {
		return String(value || "").replace(/\s+/g, " ").trim();
	}

	// Normalizes text for matching while preserving string length.
	// Important: replacements must be 1:1 so index mapping stays valid.
	function normalizeForMatch(value) {
		return String(value || "")
			.replace(/\u00A0/g, " ") // NBSP
			.replace(/[\u200B\u200C\u200D\uFEFF]/g, "") // zero-width chars
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-") // hyphen/dash variants
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'") // single quotes
			.replace(/[\u201C\u201D\u201E\u201F]/g, "\""); // double quotes
	}

	function buildCandidateRegex(candidateNormalized) {
		const whitespacePattern = "[\\s\\u00A0\\u200B\\u200C\\u200D]*";
		const tokens = String(candidateNormalized || "").split(/\s+/).filter(Boolean);
		if (!tokens.length) {
			return null;
		}

		const tokenPatterns = tokens.map((token) => {
			const lower = token.toLowerCase();
			if (token === "+") {
				return "(?:\\+|and)";
			}
			if (lower === "and") {
				return "(?:and|\\+)";
			}
			return escapeRegExp(token);
		});

		return new RegExp(tokenPatterns.join(whitespacePattern), "gi");
	}

	// Builds progressively looser match candidates when backend claims are normalized
	// assertions rather than exact substrings from the assistant message.
	function buildMatchCandidates(sentence) {
		const normalized = normalizeSentence(sentence);
		if (!normalized) {
			return [];
		}

		const candidates = [];
		const seen = new Set();

		function addCandidate(value) {
			const candidate = normalizeSentence(value).replace(/[.!?]+$/, "");
			if (!candidate || candidate.length < 18) {
				return;
			}
			const key = candidate.toLowerCase();
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			candidates.push(candidate);
		}

		addCandidate(normalized);

		// Trim leading proper-name subject + copula/aux patterns.
		addCandidate(
			normalized.replace(
				/^(?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,4}\s+(?:is|are|was|were|has|have|had|did|does|do|can|could|may|might|would|should|will)\s+/,
				""
			)
		);

		// Trim common lead-in clauses that may vary between extraction and response text.
		addCandidate(normalized.replace(/^(?:according to .*?,|historians .*? claim(?:ed)?\s+)/i, ""));

		const words = normalized.split(/\s+/).filter(Boolean);
		const windowSizes = [10, 8, 6];
		for (const windowSize of windowSizes) {
			if (words.length < windowSize) {
				continue;
			}
			for (let index = 0; index <= words.length - windowSize; index += 1) {
				addCandidate(words.slice(index, index + windowSize).join(" "));
			}
		}

		return candidates;
	}

	// Clears previously injected highlight marks before a fresh pass.
	function removeExistingHighlights() {
		const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
		highlights.forEach((node) => {
			const textNode = document.createTextNode(node.textContent || "");
			const parent = node.parentNode;
			if (!parent) {
				return;
			}
			parent.replaceChild(textNode, node);
			parent.normalize();
		});
	}

	// Creates the shared tooltip element if it does not already exist.
	function ensureTooltip() {
		let tooltip = document.getElementById(TOOLTIP_ID);
		if (!tooltip) {
			tooltip = document.createElement("div");
			tooltip.id = TOOLTIP_ID;
			tooltip.style.display = "none";
			document.body.appendChild(tooltip);
		}
		return tooltip;
	}

	// Removes the shared tooltip when the page is reset.
	function removeTooltip() {
		const tooltip = document.getElementById(TOOLTIP_ID);
		if (tooltip) {
			tooltip.remove();
		}
	}

	// Injects the styles used by the highlights and tooltip.
	function ensureStyles() {
		if (document.getElementById(STYLE_ID)) {
			return;
		}

		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = `
			.${HIGHLIGHT_CLASS} {
				background: rgba(255, 210, 77, 0.4);
				border-bottom: 2px solid rgba(231, 145, 0, 0.8);
				border-radius: 3px;
				cursor: pointer;
				transition: background 0.2s;
			}
			.${HIGHLIGHT_CLASS}:hover {
				filter: brightness(1.2);
			}

			/* Status Coloring */
			.${HIGHLIGHT_CLASS}[data-hd-status="CONTRADICTED"] {
				background: rgba(239, 68, 68, 0.25);
				border-bottom-color: rgba(239, 68, 68, 0.95);
			}
			.${HIGHLIGHT_CLASS}[data-hd-status="UNVERIFIED"], .${HIGHLIGHT_CLASS}[data-hd-status="N/A"] {
				background: rgba(245, 158, 11, 0.25);
				border-bottom-color: rgba(245, 158, 11, 0.95);
			}
			.${HIGHLIGHT_CLASS}[data-hd-status="VERIFIED"] {
				background: rgba(16, 185, 129, 0.25);
				border-bottom-color: rgba(16, 185, 129, 0.95);
			}
			.${HIGHLIGHT_CLASS}[data-hd-status="UNVERIFIABLE_SOURCE"] {
				background: rgba(107, 114, 128, 0.25);
				border-bottom-color: rgba(107, 114, 128, 0.95);
			}

			#${TOOLTIP_ID} {
				position: fixed;
				z-index: 2147483647;
				max-width: 360px;
				padding: 10px 12px;
				border-radius: 8px;
				background: #111827;
				color: #f9fafb;
				box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
				border: 1px solid rgba(255, 255, 255, 0.12);
				font-size: 12px;
				line-height: 1.4;
				pointer-events: none;
			}

			#${TOOLTIP_ID} .hd-row {
				margin: 4px 0;
			}

			#${TOOLTIP_ID} .hd-label {
				color: #93c5fd;
				font-weight: 600;
			}

			#hd-toggle-btn {
				position: fixed;
				bottom: 24px;
				right: 24px;
				width: 44px;
				height: 44px;
				border-radius: 50%;
				background: #111827;
				color: white;
				border: 1px solid rgba(255, 255, 255, 0.2);
				box-shadow: 0 4px 12px rgba(0,0,0,0.3);
				z-index: 2147483647;
				cursor: pointer;
				font-size: 20px;
				display: flex;
				align-items: center;
				justify-content: center;
				transition: opacity 0.2s, transform 0.2s;
			}

			#hd-toggle-btn:hover {
				transform: scale(1.05);
			}

			body.hd-hidden .${HIGHLIGHT_CLASS} {
				background: transparent !important;
				border-bottom: none !important;
			}

			#hd-summary-banner {
				position: fixed;
				top: 24px;
				left: 50%;
				transform: translateX(-50%);
				background: rgba(17, 24, 39, 0.95);
				backdrop-filter: blur(8px);
				color: white;
				padding: 12px 20px;
				border-radius: 8px;
				box-shadow: 0 10px 40px rgba(0,0,0,0.5);
				z-index: 2147483647;
				display: none;
				flex-direction: column;
				gap: 4px;
				min-width: 320px;
				border: 1px solid rgba(255,255,255,0.1);
				transition: opacity 0.3s, transform 0.3s;
				pointer-events: auto;
			}
			#hd-summary-banner .hd-banner-close {
				position: absolute;
				top: 6px;
				right: 8px;
				width: 26px;
				height: 26px;
				border-radius: 6px;
				border: 1px solid rgba(255,255,255,0.12);
				background: rgba(17, 24, 39, 0.65);
				color: #e5e7eb;
				cursor: pointer;
				font-size: 16px;
				line-height: 1;
				display: flex;
				align-items: center;
				justify-content: center;
			}
			#hd-summary-banner .hd-banner-close:hover {
				background: rgba(17, 24, 39, 0.9);
				border-color: rgba(255,255,255,0.2);
			}
			#hd-summary-banner .hd-banner-score {
				font-size: 16px;
				font-weight: 700;
				letter-spacing: 0.5px;
			}
			#hd-summary-banner .hd-banner-msg {
				font-size: 13px;
				color: #d1d5db;
			}
			body.hd-hidden #hd-summary-banner {
				opacity: 0;
				transform: translate(-50%, -20px);
			}

			#hd-summary-banner[data-hd-state="loading"] .hd-banner-score,
			#hd-summary-banner[data-hd-state="idle"] .hd-banner-score,
			#hd-summary-banner[data-hd-state="error"] .hd-banner-score {
				display: flex;
				align-items: center;
				gap: 8px;
			}

			#hd-summary-banner .hd-loader {
				width: 14px;
				height: 14px;
				border: 2px solid rgba(255, 255, 255, 0.35);
				border-top-color: #60a5fa;
				border-radius: 999px;
				animation: hd-spin 0.9s linear infinite;
			}

			@keyframes hd-spin {
				to {
					transform: rotate(360deg);
				}
			}
		`;

		document.head.appendChild(style);
	}

	// Keeps the tooltip within the viewport while following the pointer.
	function setTooltipPosition(tooltip, clientX, clientY) {
		const offset = 14;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const rect = tooltip.getBoundingClientRect();

		let left = clientX + offset;
		let top = clientY + offset;

		if (left + rect.width > viewportWidth - 8) {
			left = clientX - rect.width - offset;
		}

		if (top + rect.height > viewportHeight - 8) {
			top = clientY - rect.height - offset;
		}

		left = Math.max(8, left);
		top = Math.max(8, top);
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	}

	// Binds delegated hover handlers once for all highlight marks.
	function bindTooltipEvents() {
		if (document.body.getAttribute(ROOT_ATTR) === "bound") {
			return;
		}

		function getTooltip() {
			return ensureTooltip();
		}

		document.addEventListener("mouseover", (event) => {
			const target = event.target instanceof Element ? event.target.closest(`.${HIGHLIGHT_CLASS}`) : null;
			if (!target) {
				return;
			}

			const tooltip = getTooltip();

			const score = target.getAttribute("data-hd-score") || "N/A";
			const status = target.getAttribute("data-hd-status") || "UNKNOWN";
			const type = target.getAttribute("data-hd-type");
			const entailment = target.getAttribute("data-hd-ent");
			const contradiction = target.getAttribute("data-hd-con");
			const neutral = target.getAttribute("data-hd-neu");
			const sourcesChecked = target.getAttribute("data-hd-src") || "";
			const citations = target.getAttribute("data-hd-citations") || "";
			const note = target.getAttribute("data-hd-note") || "No details available.";
			const snippet = target.getAttribute("data-hd-snippet") || "";
			const sourcesJson = target.getAttribute("data-hd-sources-json") || "";
			const snippetsJson = target.getAttribute("data-hd-snippets-json") || "";

			let statusColor = "#f9fafb";
			if (status === "CONTRADICTED") statusColor = "#ef4444";
			else if (status === "UNVERIFIED") statusColor = "#f59e0b";
			else if (status === "VERIFIED") statusColor = "#10b981";
			else if (status === "UNVERIFIABLE_SOURCE") statusColor = "#9ca3af";

			let extraHtml = "";
			if (type && type !== "null") extraHtml += `<div class="hd-row" style="display:flex; justify-content:space-between;"><span class="hd-label">Type:</span> <span>${type}</span></div>`;
			if (entailment && entailment !== "null") extraHtml += `<div class="hd-row" style="display:flex; justify-content:space-between;"><span class="hd-label">Entailment:</span> <span>${parseFloat(entailment).toFixed(3)}</span></div>`;
			if (contradiction && contradiction !== "null") extraHtml += `<div class="hd-row" style="display:flex; justify-content:space-between;"><span class="hd-label">Contradiction:</span> <span>${parseFloat(contradiction).toFixed(3)}</span></div>`;
			if (neutral && neutral !== "null") extraHtml += `<div class="hd-row" style="display:flex; justify-content:space-between;"><span class="hd-label">Neutral:</span> <span>${parseFloat(neutral).toFixed(3)}</span></div>`;
			const parsedSources = safeParseJson(sourcesJson, []);
			const parsedSnippets = safeParseJson(snippetsJson, []);

			const sourcesListHtml = Array.isArray(parsedSources) && parsedSources.length
				? `<ol style="margin:4px 0 0 18px; padding:0;">${parsedSources
						.map((value) => `<li style="margin:2px 0;">${escapeHtml(value)}</li>`)
						.join("")}</ol>`
				: (sourcesChecked ? `<div style="margin-top:4px;">${escapeHtml(sourcesChecked)}</div>` : "");

			const snippetsListHtml = Array.isArray(parsedSnippets) && parsedSnippets.length
				? `<ol style="margin:4px 0 0 18px; padding:0;">${parsedSnippets
						.map((entry) => {
							if (!entry || typeof entry !== "object") {
								return "";
							}
							const sourceNumber = Number(entry.sourceNumber);
							const prefix = Number.isFinite(sourceNumber) && sourceNumber > 0 ? `[${sourceNumber}] ` : "";
							return `<li style="margin:2px 0;">${escapeHtml(prefix + String(entry.text || ""))}</li>`;
						})
						.join("")}</ol>`
				: (snippet ? `<div style="margin-top:4px;">${escapeHtml(snippet)}</div>` : "");

			const citationsHtml = citations
				? `<div class="hd-row" style="margin-top:2px;"><span class="hd-label">Citations:</span> ${escapeHtml(citations)}</div>`
				: "";

			tooltip.innerHTML = `
				<div class="hd-row" style="margin-bottom: 8px; font-size: 14px; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">
					<span style="color: ${statusColor}">${status}</span>
				</div>
				<div class="hd-row" style="display:flex; justify-content:space-between;"><span class="hd-label">Risk Score:</span> <span>${score}</span></div>
				${extraHtml}
				<div class="hd-row" style="margin-top:6px;"><span class="hd-label">Sources:</span>${sourcesListHtml || " <span>N/A</span>"}</div>
				${citationsHtml}
				<div class="hd-row" style="margin-top:4px;"><span class="hd-label">Snippets:</span>${snippetsListHtml || " <span>N/A</span>"}</div>
				<div class="hd-row" style="margin-top:4px;"><span class="hd-label">Note:</span> ${escapeHtml(note)}</div>
			`;
			tooltip.style.display = "block";

			if (event instanceof MouseEvent) {
				setTooltipPosition(tooltip, event.clientX, event.clientY);
			}
		}, true);

			document.addEventListener("mousemove", (event) => {
			const tooltip = getTooltip();
			if (tooltip.style.display !== "block") {
				return;
			}
			setTooltipPosition(tooltip, event.clientX, event.clientY);
		}, true);

		document.addEventListener("mouseout", (event) => {
			const fromNode = event.target instanceof Element ? event.target.closest(`.${HIGHLIGHT_CLASS}`) : null;
			if (!fromNode) {
				return;
			}

			const toNode = event.relatedTarget instanceof Element ? event.relatedTarget.closest(`.${HIGHLIGHT_CLASS}`) : null;
			if (toNode && toNode === fromNode) {
				return;
			}

			const tooltip = getTooltip();
			tooltip.style.display = "none";
		}, true);

		document.body.setAttribute(ROOT_ATTR, "bound");
	}

	// Returns assistant message containers in DOM order, supporting ChatGPT, Gemini, Claude, DeepSeek, and Copilot.
	function getAssistantMessageNodes() {
		const selectors = [
			// ChatGPT
			'[data-message-author-role="assistant"]',
			// Claude
			'[data-testid="assistant-message"]',
			// Gemini custom elements
			"model-response",
			"response-container",
			"[class*='model-response']",
			"[class*='response-container']",
			// DeepSeek
			".ds-markdown",
			"[class*='ds-markdown']",
			// Copilot Web Components
			'cib-message-group[source="bot"]',
			'cib-message-group[source="assistant"]',
			"[class*='bot-message']",
			"[class*='ai-message']"
		];

		const seen = new WeakSet();
		const nodes = [];

		for (const selector of selectors) {
			try {
				for (const el of document.querySelectorAll(selector)) {
					if (!seen.has(el)) {
						seen.add(el);
						nodes.push(el);
					}
				}
			} catch {
				// ignore invalid selectors
			}
		}

		// Sort into DOM order so highlights are applied sequentially.
		nodes.sort((a, b) => {
			const pos = a.compareDocumentPosition(b);
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});

		return nodes;
	}

	// Narrows matching to a specific assistant message when metadata provides one.
	function getTargetContainers(statementMeta, assistantNodes) {
		const assistantRoleIndex = Number.parseInt(statementMeta.assistantRoleIndex, 10);
		if (Number.isInteger(assistantRoleIndex) && assistantNodes[assistantRoleIndex]) {
			return [assistantNodes[assistantRoleIndex]];
		}

		return assistantNodes;
	}

	// Collects searchable text nodes while skipping code and already highlighted regions.
	function getTextNodes(container) {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				if (!node.nodeValue || !node.nodeValue.trim()) {
					return NodeFilter.FILTER_REJECT;
				}

				const parent = node.parentElement;
				if (!parent) {
					return NodeFilter.FILTER_REJECT;
				}

				if (parent.closest(`.${HIGHLIGHT_CLASS}`)) {
					return NodeFilter.FILTER_REJECT;
				}

				if (SKIP_TAGS.has(parent.tagName) || parent.closest("code, pre")) {
					return NodeFilter.FILTER_REJECT;
				}

				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const nodes = [];
		while (walker.nextNode()) {
			nodes.push(walker.currentNode);
		}
		return nodes;
	}

	// Merges all text nodes into a single searchable string and maintains a mapping of character indices to nodes.
	function buildTextMap(nodes) {
		let fullText = "";
		const map = []; // each entry: { node, start, end }

		for (const node of nodes) {
			const start = fullText.length;
			const text = node.nodeValue || "";
			fullText += normalizeForMatch(text);
			const end = fullText.length;
			map.push({ node, start, end });
		}

		return { fullText, map };
	}

	// Finds all overlapping text nodes for a given absolute character range.
	function getNodesForRange(map, matchStart, matchEnd) {
		const overlaps = [];
		for (const entry of map) {
			if (entry.end > matchStart && entry.start < matchEnd) {
				const localStart = Math.max(0, matchStart - entry.start);
				const localEnd = Math.min(entry.node.nodeValue.length, matchEnd - entry.start);
				overlaps.push({ node: entry.node, localStart, localEnd });
			}
		}
		return overlaps;
	}

	// Highlights matches across potentially multiple DOM text nodes.
	function highlightAcrossTextNodes(nodes, statementMeta) {
		const { fullText, map } = buildTextMap(nodes);
		const sentence = normalizeSentence(statementMeta.statement);
		if (!sentence) {
			return 0;
		}

		let matches = [];
		for (const candidate of buildMatchCandidates(sentence)) {
			const candidateNormalized = normalizeForMatch(candidate);
			const regex = buildCandidateRegex(candidateNormalized);
			if (!regex) {
				continue;
			}
			let match;
			const candidateMatches = [];

			while ((match = regex.exec(fullText)) !== null) {
				candidateMatches.push({ start: match.index, end: match.index + match[0].length });
			}

			if (candidateMatches.length) {
				matches = candidateMatches;
				break;
			}
		}

		if (!matches.length) return 0;

		// Process matches in reverse so we don't invalidate previous splits
		for (let i = matches.length - 1; i >= 0; i--) {
			const { start, end } = matches[i];
			const overlapping = getNodesForRange(map, start, end);

			for (let j = overlapping.length - 1; j >= 0; j--) {
				const { node, localStart, localEnd } = overlapping[j];
				if (!node.parentNode) continue;

				let middleNode = node;
				if (localStart > 0) {
					middleNode = middleNode.splitText(localStart);
				}
				if (localEnd - localStart < middleNode.nodeValue.length) {
					middleNode.splitText(localEnd - localStart);
				}

				const mark = document.createElement("mark");
				mark.className = HIGHLIGHT_CLASS;
				mark.textContent = middleNode.nodeValue;
				mark.setAttribute("data-hd-score", String(statementMeta.score ?? "N/A"));
				mark.setAttribute("data-hd-status", statementMeta.status || "UNVERIFIED");
				mark.setAttribute("data-hd-type", String(statementMeta.type ?? "null"));
				mark.setAttribute("data-hd-ent", String(statementMeta.entailment_score ?? "null"));
				mark.setAttribute("data-hd-con", String(statementMeta.contradiction_score ?? "null"));
				mark.setAttribute("data-hd-neu", String(statementMeta.neutral_score ?? "null"));
				mark.setAttribute("data-hd-src", String(statementMeta.sources_checked || ""));
				mark.setAttribute("data-hd-citations", Array.isArray(statementMeta.citations) ? statementMeta.citations.filter(Boolean).join(", ") : "N/A");
				mark.setAttribute("data-hd-note", statementMeta.note || "No details available.");
				mark.setAttribute("data-hd-snippet", statementMeta.snippet || "");
				mark.setAttribute(
					"data-hd-sources-json",
					Array.isArray(statementMeta.sources) ? JSON.stringify(statementMeta.sources) : "[]"
				);
				mark.setAttribute(
					"data-hd-snippets-json",
					Array.isArray(statementMeta.snippets) ? JSON.stringify(statementMeta.snippets) : "[]"
				);

				middleNode.parentNode.replaceChild(mark, middleNode);
			}
		}

		return matches.length;
	}

	// Injects a floating toggle button (Eye Icon) to show/hide highlights.
	function ensureToggleButton() {
		if (document.getElementById("hd-toggle-btn")) {
			return;
		}

		const btn = document.createElement("button");
		btn.id = "hd-toggle-btn";
		btn.innerHTML = "👁️"; // Eye icon
		btn.title = "Toggle AI Highlights";
		document.body.appendChild(btn);

		btn.addEventListener("click", () => {
			document.body.classList.toggle("hd-hidden");
			btn.style.opacity = document.body.classList.contains("hd-hidden") ? "0.5" : "1";
		});
	}

	// Injects and updates the top visual summary banner
	function ensureSummaryBanner(summary) {
		let banner = document.getElementById(SUMMARY_BANNER_ID);
		if (!banner) {
			banner = document.createElement("div");
			banner.id = SUMMARY_BANNER_ID;
			document.body.appendChild(banner);
		}

		if (isSummaryDismissed()) {
			banner.style.display = "none";
			return;
		}

		if (!summary) {
			banner.removeAttribute("data-hd-state");
			banner.style.display = "none";
			return;
		}

		const summaryState = String(summary.state || "result").toLowerCase();
		banner.setAttribute("data-hd-state", summaryState);
		banner.style.display = "flex";

		function attachClose() {
			const closeBtn = banner.querySelector(".hd-banner-close");
			if (!closeBtn) {
				return;
			}
			closeBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				setSummaryDismissed(true);
				banner.style.display = "none";
			});
		}

		if (summaryState === "loading") {
			banner.innerHTML = `
				<button type="button" class="hd-banner-close" aria-label="Close">×</button>
				<div class="hd-banner-score" style="color: #60a5fa;">
					<span class="hd-loader" aria-hidden="true"></span>
					Analyzing Conversation
				</div>
				<div class="hd-banner-msg">${escapeHtml(summary.message || "Please wait while detection runs...")}</div>
			`;
			attachClose();
			return;
		}

		if (summaryState === "idle") {
			banner.innerHTML = `
				<button type="button" class="hd-banner-close" aria-label="Close">×</button>
				<div class="hd-banner-score" style="color: ${summary.color || "#9CA3AF"};">
					Awaiting New Analysis
				</div>
				<div class="hd-banner-msg">${escapeHtml(summary.message || "No new assistant response detected.")}</div>
			`;
			attachClose();
			return;
		}

		if (summaryState === "error") {
			banner.innerHTML = `
				<button type="button" class="hd-banner-close" aria-label="Close">×</button>
				<div class="hd-banner-score" style="color: #ef4444;">
					Detection Failed
				</div>
				<div class="hd-banner-msg">${escapeHtml(summary.message || "Please try again.")}</div>
			`;
			attachClose();
			return;
		}

		const numericScore = Number(summary.score);
		const scoreLabel = Number.isFinite(numericScore) ? numericScore.toFixed(1) : "N/A";

		banner.innerHTML = `
			<button type="button" class="hd-banner-close" aria-label="Close">×</button>
			<div class="hd-banner-score" style="color: ${summary.color};">
				Overall Risk: ${scoreLabel} (${summary.level || "UNKNOWN"})
			</div>
			<div class="hd-banner-msg">${escapeHtml(summary.message)}</div>
		`;
		attachClose();
	}

	function resetInjectedUiForNavigation() {
		window[DISMISS_KEY] = false;
		removeExistingHighlights();
		clearMessageBadges();
		ensureSummaryBanner(null);
		const tooltip = document.getElementById(TOOLTIP_ID);
		if (tooltip) {
			tooltip.style.display = "none";
		}
	}

	function bindNavigationWatcher() {
		if (window[NAV_WATCHER_KEY]) {
			return;
		}
		window[NAV_WATCHER_KEY] = true;

		let lastHref = String(window.location.href);
		setInterval(() => {
			const href = String(window.location.href);
			if (href === lastHref) {
				return;
			}
			lastHref = href;
			resetInjectedUiForNavigation();
		}, 500);
	}

	function clearMessageBadges() {
		document.querySelectorAll('.hd-message-badge').forEach((badge) => badge.remove());
	}

	function applyMessageBadges(messageResults, assistantNodes) {
		clearMessageBadges();
		
		if (!messageResults || !assistantNodes) return;
		
		messageResults.forEach(msgRes => {
			if (msgRes.assistantRoleIndex != null && assistantNodes[msgRes.assistantRoleIndex]) {
				const container = assistantNodes[msgRes.assistantRoleIndex];
				const badge = document.createElement("div");
				badge.className = "hd-message-badge";
				
				let badgeColor = "#22c55e"; // low
				if (msgRes.risk_level === "MODERATE") badgeColor = "#eab308";
				else if (msgRes.risk_level === "HIGH") badgeColor = "#f97316";
				else if (msgRes.risk_level === "CRITICAL") badgeColor = "#ef4444";
				
				badge.innerHTML = `🛡️ Risk Score: <strong style="color: ${badgeColor};">${msgRes.risk_score.toFixed(1)}</strong>`;
				badge.style.cssText = `
					margin-top: 12px;
					padding: 6px 12px;
					border-radius: 6px;
					font-size: 13px;
					background: rgba(30,30,30,0.8);
					border: 1px solid ${badgeColor}40;
					color: #e5e7eb;
					display: inline-block;
					backdrop-filter: blur(4px);
				`;
				
				container.appendChild(badge);
			}
		});
	}

	// The primary entry point for painting highlights into the DOM
	function applyHighlights(payload) {
		if (!payload || typeof payload !== "object") {
			return { highlighted: 0, unmatched: [] };
		}
		const statementsWithMeta = Array.isArray(payload) ? payload : (payload?.items || []);
		const summary = Array.isArray(payload) ? null : (payload?.summary || null);

		ensureStyles();
		removeExistingHighlights();
		clearMessageBadges();
		ensureTooltip();
		ensureToggleButton(); // Make sure the toggle button is in the DOM
		ensureSummaryBanner(summary);
		bindNavigationWatcher();
		bindTooltipEvents();

		const assistantNodes = getAssistantMessageNodes();
		applyMessageBadges(payload.message_results, assistantNodes);
		
		if (!assistantNodes.length) {
			return {
				highlighted: 0,
				unmatched: statementsWithMeta.map((item) => item.statement)
			};
		}

		const deduped = [];
		const seen = new Set();
		for (const item of statementsWithMeta || []) {
			const key = `${normalizeSentence(item.statement).toLowerCase()}::${item.assistantRoleIndex ?? "all"}`;
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			deduped.push(item);
		}

		let highlighted = 0;
		const matchedStatements = new Set();

		for (const statementMeta of deduped) {
			const targetContainers = getTargetContainers(statementMeta, assistantNodes);
			let foundMatches = false;

			for (const container of targetContainers) {
				const nodes = getTextNodes(container);
				const count = highlightAcrossTextNodes(nodes, statementMeta);
				if (count > 0) {
					highlighted += count;
					foundMatches = true;
				}
			}

			// Fallback: If targeted node failed, search all other assistant nodes
			if (!foundMatches && targetContainers.length < assistantNodes.length) {
				for (const container of assistantNodes) {
					if (targetContainers.includes(container)) continue;
					const nodes = getTextNodes(container);
					const count = highlightAcrossTextNodes(nodes, statementMeta);
					if (count > 0) {
						highlighted += count;
						foundMatches = true;
					}
				}
			}

			if (foundMatches) {
				matchedStatements.add(normalizeSentence(statementMeta.statement));
			}
		}

		const unmatched = deduped
			.map((item) => normalizeSentence(item.statement))
			.filter((statement) => !matchedStatements.has(statement));

		return {
			highlighted,
			unmatched
		};
	}

	function setDetectionState(statePayload) {
		ensureStyles();
		removeExistingHighlights();
		clearMessageBadges();
		ensureTooltip();
		ensureToggleButton();
		bindTooltipEvents();
		ensureSummaryBanner(statePayload || { state: "loading" });

		return { ok: true };
	}

	window.__hdApplyHighlights = applyHighlights;
	window.__hdSetDetectionState = setDetectionState;
})();
