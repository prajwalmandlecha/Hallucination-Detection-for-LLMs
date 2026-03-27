chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    console.warn("No active tab id was found.");
    return;
  }

  const url = tab.url || "";
  const isChatGptPage =
    url.startsWith("https://chatgpt.com/") ||
    url.startsWith("https://chat.openai.com/");

  if (!isChatGptPage) {
    console.warn("Open a ChatGPT conversation tab first.");
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const turns = Array.from(document.querySelectorAll("[data-message-author-role]"));

        const extracted = turns
          .map((node, index) => {
            const role = node.getAttribute("data-message-author-role") || "unknown";
            const text = (node.innerText || "").trim();
            return {
              index,
              role,
              text
            };
          })
          .filter((item) => item.text.length > 0);

        console.log("[ChatGPT Extractor] Extracted chat messages:", extracted);
        return extracted;
      }
    });

    console.log("[ChatGPT Extractor] Extracted chat messages:", result);
  } catch (error) {
    console.error("[ChatGPT Extractor] Extraction failed:", error);
  }
});
