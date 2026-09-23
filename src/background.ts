/**
 * a11y-pilot: src/background.ts
 * Chrome Extension Manifest V3 Background Service Worker.
 * Strict TypeScript implementation.
 */

// Configure side panel to open on action click when supported
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.log('[a11y-pilot:background] SidePanel behavior note:', error));
}

// Fallback for action click
if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (chrome.sidePanel && chrome.sidePanel.open && tab.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
        console.warn('[a11y-pilot:background] Error opening side panel:', err);
      });
    }
  });
}

// Installation lifecycle & Header modification rule setup
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      console.log('[a11y-pilot] Installed successfully.');
    }

    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1001],
        addRules: [
          {
            id: 1001,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [
                {
                  header: 'User-Agent',
                  operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                  value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
                },
              ],
            },
            condition: {
              urlFilter: '||speech.platform.bing.com',
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.WEBSOCKET,
                chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                chrome.declarativeNetRequest.ResourceType.OTHER,
              ],
            },
          },
        ],
      }).catch((err) => console.warn('[a11y-pilot:background] Dynamic rule error:', err));
    }
  });
}
