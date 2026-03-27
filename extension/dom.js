(() => {
	const ROOT_ATTR = "data-hd-root";
	const HIGHLIGHT_CLASS = "hd-highlight";
	const TOOLTIP_ID = "hd-tooltip";
	const STYLE_ID = "hd-highlight-style";
	const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "MARK", "NOSCRIPT", "TEXTAREA"]);

	// Escapes user text so it can be used safely inside a RegExp.
	function escapeRegExp(value) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// Normalizes sentence text for matching and deduping.
	function normalizeSentence(value) {
		return String(value || "").replace(/\s+/g, " ").trim();
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
				background: rgba(255, 210, 77, 0.55);
				border-bottom: 2px solid rgba(231, 145, 0, 0.95);
				border-radius: 3px;
				cursor: pointer;
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

		const tooltip = ensureTooltip();

		document.addEventListener("mouseover", (event) => {
			const target = event.target instanceof Element ? event.target.closest(`.${HIGHLIGHT_CLASS}`) : null;
			if (!target) {
				return;
			}

			const score = target.getAttribute("data-hd-score") || "N/A";
			const citations = target.getAttribute("data-hd-citations") || "N/A";
			const note = target.getAttribute("data-hd-note") || "No details available.";

			tooltip.innerHTML = `
				<div class="hd-row"><span class="hd-label">Score:</span> ${score}</div>
				<div class="hd-row"><span class="hd-label">Citations:</span> ${citations}</div>
				<div class="hd-row"><span class="hd-label">Note:</span> ${note}</div>
			`;
			tooltip.style.display = "block";

			if (event instanceof MouseEvent) {
				setTooltipPosition(tooltip, event.clientX, event.clientY);
			}
		}, true);

		document.addEventListener("mousemove", (event) => {
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

	// Replaces matching text inside one text node with highlighted markup.
	function highlightInTextNode(textNode, statementMeta) {
		const text = textNode.nodeValue || "";
		const sentence = normalizeSentence(statementMeta.statement);
		if (!sentence) {
			return 0;
		}

		const regex = new RegExp(escapeRegExp(sentence).replace(/\s+/g, "\\s+"), "gi");
		if (!regex.test(text)) {
			return 0;
		}

		regex.lastIndex = 0;
		const fragment = document.createDocumentFragment();
		let lastIndex = 0;
		let matchCount = 0;
		let match;

		while ((match = regex.exec(text)) !== null) {
			const start = match.index;
			const end = start + match[0].length;

			if (start > lastIndex) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
			}

			const mark = document.createElement("mark");
			mark.className = HIGHLIGHT_CLASS;
			mark.textContent = text.slice(start, end);
			mark.setAttribute("data-hd-score", String(statementMeta.score ?? "N/A"));
			mark.setAttribute("data-hd-citations", Array.isArray(statementMeta.citations) ? statementMeta.citations.join(", ") : "N/A");
			mark.setAttribute("data-hd-note", statementMeta.note || "No details available.");
			fragment.appendChild(mark);

			lastIndex = end;
			matchCount += 1;
		}

		if (lastIndex < text.length) {
			fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
		}

		if (!textNode.parentNode) {
			return 0;
		}

		textNode.parentNode.replaceChild(fragment, textNode);
		return matchCount;
	}

	// Applies all normalized highlight items to the current ChatGPT conversation.
	function applyHighlights(statementsWithMeta) {
		ensureStyles();
		removeExistingHighlights();
		ensureTooltip();
		bindTooltipEvents();

		const assistantNodes = getAssistantMessageNodes();
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
			for (const container of targetContainers) {
				const nodes = getTextNodes(container);
				for (const textNode of nodes) {
					const count = highlightInTextNode(textNode, statementMeta);
					if (count > 0) {
						highlighted += count;
						matchedStatements.add(normalizeSentence(statementMeta.statement));
					}
				}
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

	window.__hdApplyHighlights = applyHighlights;
})();
