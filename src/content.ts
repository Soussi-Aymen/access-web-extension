/**
 * a11y-pilot: src/content.ts
 * Injected into active pages to:
 * 1. Inspect the interactive accessibility hierarchy.
 * 2. Extract ONLY actionable interactive elements (roles: button, link, searchbox, textbox, combobox, checkbox).
 * 3. Compute accurate accessible names according to W3C AccName guidelines.
 * 4. Assign transient unique `data-agent-id` attributes.
 * 5. Execute conversational actions natively (clicks, input fills, form submissions, smooth scrolling).
 * 
 * Strict TypeScript implementation.
 */

import type {
  ActionableElement,
  ActionableRole,
  ActionResult,
  AgentAction,
  ExtensionMessage,
  PageScanPayload,
} from './types/index.js';

declare global {
  interface Window {
    __a11yPilotContentInjected?: boolean;
  }
}

(() => {
  if (window.__a11yPilotContentInjected) {
    return;
  }
  window.__a11yPilotContentInjected = true;

  const AGENT_ID_ATTR = 'data-agent-id';
  const HIGHLIGHT_CLASS = 'a11y-pilot-highlight-ring';
  const BADGE_CONTAINER_ID = 'a11y-pilot-badge-container';

  const elementRegistry = new Map<number, HTMLElement>();
  let badgeIntersectionObserver: IntersectionObserver | null = null;
  let scrollListenerAttached = false;

  function ensureHighlightStyles(): void {
    if (document.getElementById('a11y-pilot-styles')) return;
    const style = document.createElement('style');
    style.id = 'a11y-pilot-styles';
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 3px solid #2563eb !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.3) !important;
        transition: outline 0.2s ease, box-shadow 0.2s ease !important;
      }
      .a11y-pilot-number-badge {
        position: absolute;
        z-index: 2147483647;
        background-color: #2563eb;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 9999px;
        border: 1.5px solid #ffffff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        user-select: none;
        transform: translate(-50%, -50%);
        transition: opacity 0.15s ease;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getOrCreateBadgeContainer(): HTMLElement {
    let container = document.getElementById(BADGE_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = BADGE_CONTAINER_ID;
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '2147483646';
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function refreshBadgesInViewport(): void {
    const container = getOrCreateBadgeContainer();
    container.innerHTML = '';

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;

    elementRegistry.forEach((el, id) => {
      const rect = el.getBoundingClientRect();
      // Only show badge if element is intersecting the current viewport
      const inViewport = (
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth &&
        rect.width > 0 &&
        rect.height > 0
      );

      if (inViewport) {
        const badge = document.createElement('span');
        badge.className = 'a11y-pilot-number-badge';
        badge.textContent = String(id);
        badge.style.left = `${rect.left + scrollX}px`;
        badge.style.top = `${rect.top + scrollY}px`;
        container.appendChild(badge);
      }
    });
  }

  function setupBadgeObserver(): void {
    if (badgeIntersectionObserver) {
      badgeIntersectionObserver.disconnect();
    }

    try {
      badgeIntersectionObserver = new IntersectionObserver(
        () => {
          refreshBadgesInViewport();
        },
        { threshold: [0, 0.1, 0.5, 1.0] }
      );

      elementRegistry.forEach((el) => {
        badgeIntersectionObserver!.observe(el);
      });
    } catch {
      refreshBadgesInViewport();
    }

    if (!scrollListenerAttached) {
      scrollListenerAttached = true;
      let scrollDebounce: any = null;
      window.addEventListener(
        'scroll',
        () => {
          if (scrollDebounce) cancelAnimationFrame(scrollDebounce);
          scrollDebounce = requestAnimationFrame(() => {
            refreshBadgesInViewport();
          });
        },
        { passive: true }
      );

      window.addEventListener(
        'resize',
        () => {
          refreshBadgesInViewport();
        },
        { passive: true }
      );
    }
  }

  function clearExistingAgentIds(): void {
    const existing = document.querySelectorAll(`[${AGENT_ID_ATTR}]`);
    existing.forEach((el) => el.removeAttribute(AGENT_ID_ATTR));
    elementRegistry.clear();
    const container = document.getElementById(BADGE_CONTAINER_ID);
    if (container) container.innerHTML = '';
    if (badgeIntersectionObserver) {
      badgeIntersectionObserver.disconnect();
    }
  }

  function isElementVisibleAndUsable(el: HTMLElement): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;

    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    if (el.hasAttribute('hidden') || el.closest('[aria-hidden="true"]') || el.closest('[inert]')) {
      return false;
    }

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) < 0.05 ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) {
      return false;
    }

    return true;
  }

  function determineActionableRole(el: HTMLElement): ActionableRole | null {
    const explicitRole = (el.getAttribute('role') || '').toLowerCase().trim();
    const tagName = el.tagName.toLowerCase();

    if (explicitRole === 'button') return 'button';
    if (explicitRole === 'link') return 'link';
    if (explicitRole === 'searchbox') return 'searchbox';
    if (explicitRole === 'textbox') return 'textbox';
    if (explicitRole === 'combobox') return 'combobox';
    if (explicitRole === 'checkbox' || explicitRole === 'switch') return 'checkbox';

    if (tagName === 'button' || tagName === 'summary') {
      return 'button';
    }

    if (tagName === 'a' && el.hasAttribute('href')) {
      return 'link';
    }

    if (tagName === 'select') {
      return 'combobox';
    }

    if (tagName === 'textarea') {
      return 'textbox';
    }

    if (tagName === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();

      if (['button', 'submit', 'reset', 'image'].includes(type)) {
        return 'button';
      }

      if (type === 'checkbox') {
        return 'checkbox';
      }

      if (type === 'search') {
        return 'searchbox';
      }

      if (['text', 'email', 'tel', 'url', 'number', 'password'].includes(type) || !type) {
        const nameAttr = (el.getAttribute('name') || '').toLowerCase();
        const idAttr = (el.getAttribute('id') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

        if (
          nameAttr.includes('search') ||
          nameAttr === 'q' ||
          idAttr.includes('search') ||
          placeholder.includes('search') ||
          ariaLabel.includes('search')
        ) {
          return 'searchbox';
        }
        return 'textbox';
      }
    }

    return null;
  }

  function computeAccessibleName(el: HTMLElement): string {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const ids = labelledby.trim().split(/\s+/);
      const parts = ids
        .map((id) => {
          const ref = document.getElementById(id);
          return ref ? (ref.innerText || ref.textContent || '').trim() : '';
        })
        .filter(Boolean);
      if (parts.length > 0) {
        return cleanString(parts.join(' '));
      }
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      return cleanString(ariaLabel);
    }

    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        const text = (label.textContent || '').trim();
        if (text) return cleanString(text);
      }
    }

    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      const inputs = clone.querySelectorAll('input, select, textarea, button');
      inputs.forEach((i) => i.remove());
      const labelText = (clone.textContent || '').trim();
      if (labelText) return cleanString(labelText);
    }

    if (el instanceof HTMLInputElement) {
      if (['button', 'submit', 'reset'].includes(el.type) && el.value) {
        return cleanString(el.value);
      }
      if (el.placeholder) {
        return cleanString(el.placeholder);
      }
    }

    if (el instanceof HTMLTextAreaElement && el.placeholder) {
      return cleanString(el.placeholder);
    }

    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt')) {
      const altText = img.getAttribute('alt')!.trim();
      if (altText) return cleanString(altText);
    }

    const svgTitle = el.querySelector('svg title');
    if (svgTitle && svgTitle.textContent) {
      const titleText = svgTitle.textContent.trim();
      if (titleText) return cleanString(titleText);
    }

    const directText = (el.innerText || el.textContent || '').trim();
    if (directText) {
      return cleanString(directText);
    }

    const title = el.getAttribute('title');
    if (title && title.trim()) {
      return cleanString(title);
    }

    if (el.getAttribute('name')) {
      return cleanString(el.getAttribute('name')!);
    }

    return '';
  }

  function cleanString(str: string): string {
    if (!str) return '';
    let cleaned = str
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length > 90) {
      cleaned = cleaned.substring(0, 87) + '...';
    }
    return cleaned;
  }

  function getNaturalSiteName(): string {
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    if (ogSiteName && ogSiteName.trim()) {
      return ogSiteName.trim();
    }

    let host = window.location.hostname.replace(/^www\./, '');
    const dotIndex = host.indexOf('.');
    if (dotIndex > 0) {
      host = host.substring(0, dotIndex);
    }
    return host.charAt(0).toUpperCase() + host.slice(1);
  }

  function computeNearbyText(el: HTMLElement): string {
    const parent = el.parentElement;
    if (!parent) return '';
    const parentText = (parent.innerText || parent.textContent || '').trim();
    const selfText = (el.innerText || el.textContent || '').trim();
    if (!parentText) return '';
    // Strip self text if found to isolate context words
    const context = parentText.replace(selfText, '').replace(/\s+/g, ' ').trim();
    return context.length > 80 ? context.substring(0, 77) + '...' : context;
  }

  function extractPageDetails(): {
    landmarks: string[];
    headings: string[];
    counts: { links: number; buttons: number; inputs: number };
    mainContentSnippet?: string;
  } {
    const landmarks: string[] = [];
    if (document.querySelector('main, [role="main"]')) landmarks.push('main');
    if (document.querySelector('nav, [role="navigation"]')) landmarks.push('navigation');
    if (document.querySelector('[role="search"], form[action*="search"], input[type="search"]')) landmarks.push('search');
    if (document.querySelector('form, [role="form"]')) landmarks.push('form');

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 0)
      .slice(0, 5);

    const counts = {
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').length,
      inputs: document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, select').length,
    };

    let mainContentSnippet: string | undefined;
    const mainEl = document.querySelector('main, [role="main"], article') || document.body;
    if (mainEl) {
      const paragraphs = Array.from(mainEl.querySelectorAll('p'))
        .map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 20);

      const combinedText = paragraphs.slice(0, 2).join(' ');
      if (combinedText) {
        // Grab first 1 to 2 sentences
        const sentences = combinedText.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length > 0) {
          mainContentSnippet = sentences.slice(0, 2).map((s) => s.trim()).join(' ');
        } else {
          mainContentSnippet = combinedText.length > 150 ? combinedText.substring(0, 147) + '...' : combinedText;
        }
      }
    }

    return {
      landmarks,
      headings,
      counts,
      mainContentSnippet,
    };
  }

  function scanAccessibilityTree(): PageScanPayload {
    clearExistingAgentIds();
    ensureHighlightStyles();

    const candidateSelectors = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="link"]',
      '[role="searchbox"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="checkbox"]',
      '[role="switch"]',
    ].join(',');

    const candidates = Array.from(document.querySelectorAll(candidateSelectors)) as HTMLElement[];
    const extracted: ActionableElement[] = [];
    let currentId = 1;

    for (const el of candidates) {
      if (!isElementVisibleAndUsable(el)) {
        continue;
      }

      const role = determineActionableRole(el);
      if (!role) {
        continue;
      }

      const name = computeAccessibleName(el);

      if (!name && (role === 'link' || role === 'button')) {
        continue;
      }

      if (el.parentElement && el.parentElement.closest(`[${AGENT_ID_ATTR}]`)) {
        const parentAgentEl = el.parentElement.closest(`[${AGENT_ID_ATTR}]`);
        if (parentAgentEl && parentAgentEl.tagName === el.tagName) {
          continue;
        }
      }

      const nearbyText = computeNearbyText(el);
      const isSubmitInput = (
        (el instanceof HTMLInputElement && el.type === 'submit') ||
        (el instanceof HTMLButtonElement && el.type === 'submit')
      );

      el.setAttribute(AGENT_ID_ATTR, String(currentId));
      elementRegistry.set(currentId, el);

      extracted.push({
        id: currentId,
        role,
        name: name || `${role} ${currentId}`,
        nearbyText: nearbyText || undefined,
        isSubmit: isSubmitInput || undefined,
      });

      currentId++;

      if (extracted.length >= 75) {
        break;
      }
    }

    setupBadgeObserver();

    return {
      siteName: getNaturalSiteName(),
      pageTitle: document.title || 'Current Webpage',
      url: window.location.href,
      elements: extracted,
      totalCount: extracted.length,
      details: extractPageDetails(),
    };
  }

  function highlightElement(el: HTMLElement): void {
    if (!el) return;
    ensureHighlightStyles();
    el.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => {
      el.classList.remove(HIGHLIGHT_CLASS);
    }, 2000);
  }

  function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const isTextarea = el instanceof HTMLTextAreaElement;
    const proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function executeAction(action: AgentAction): ActionResult {
    const { type, id, value, direction } = action;

    if (type === 'scroll') {
      const scrollAmount = window.innerHeight * 0.75;
      if (direction === 'up' || direction === 'top') {
        if (direction === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return { success: true, message: 'Scrolled to top of page.' };
        }
        window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
        return { success: true, message: 'Scrolled up.' };
      } else {
        if (direction === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          return { success: true, message: 'Scrolled to bottom of page.' };
        }
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        return { success: true, message: 'Scrolled down.' };
      }
    }

    const targetElement =
      elementRegistry.get(Number(id)) ||
      (document.querySelector(`[${AGENT_ID_ATTR}="${id}"]`) as HTMLElement | null);

    if (!targetElement) {
      return {
        success: false,
        message: `Actionable element with ID ${id} was not found on this page. Try refreshing the scan.`,
      };
    }

    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(targetElement);

    if (type === 'click') {
      targetElement.focus();
      const mouseEventInit = { bubbles: true, cancelable: true, view: window };
      targetElement.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
      targetElement.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
      targetElement.click();

      const name = computeAccessibleName(targetElement) || 'element';
      return { success: true, message: `Clicked ${name}.` };
    }

    if (type === 'fill') {
      targetElement.focus();
      if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement) {
        setNativeInputValue(targetElement, value || '');
      }
      const name = computeAccessibleName(targetElement) || 'input';
      return { success: true, message: `Entered "${value}" into ${name}.` };
    }

    if (type === 'fill_and_submit') {
      targetElement.focus();
      if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement) {
        setNativeInputValue(targetElement, value || '');
      }

      const keyInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      targetElement.dispatchEvent(new KeyboardEvent('keydown', keyInit));
      targetElement.dispatchEvent(new KeyboardEvent('keypress', keyInit));
      targetElement.dispatchEvent(new KeyboardEvent('keyup', keyInit));

      const form = targetElement.closest('form');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement | null;
        if (submitBtn) {
          submitBtn.click();
        } else if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }

      const name = computeAccessibleName(targetElement) || 'search';
      return { success: true, message: `Searched for "${value}" in ${name}.` };
    }

    if (type === 'focus') {
      targetElement.focus();
      return { success: true, message: `Focused on ${computeAccessibleName(targetElement)}.` };
    }

    if (type === 'navigate_heading') {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
      const visibleHeadings = headings.filter((h) => isElementVisibleAndUsable(h));
      if (visibleHeadings.length === 0) {
        return { success: false, message: 'No headings found on this page.' };
      }

      const activeEl = document.activeElement;
      let currentIndex = -1;
      if (activeEl) {
        currentIndex = visibleHeadings.indexOf(activeEl as HTMLElement);
      }

      let targetHeading: HTMLElement;
      if (action.navDirection === 'previous') {
        const nextIdx = currentIndex > 0 ? currentIndex - 1 : visibleHeadings.length - 1;
        targetHeading = visibleHeadings[nextIdx]!;
      } else {
        const nextIdx = currentIndex >= 0 && currentIndex < visibleHeadings.length - 1 ? currentIndex + 1 : 0;
        targetHeading = visibleHeadings[nextIdx]!;
      }

      targetHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightElement(targetHeading);
      targetHeading.setAttribute('tabindex', '-1');
      targetHeading.focus();
      const text = (targetHeading.textContent || '').replace(/\s+/g, ' ').trim();
      return { success: true, message: `Heading: ${text}` };
    }

    if (type === 'navigate_link') {
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLElement[];
      const visibleLinks = links.filter((l) => isElementVisibleAndUsable(l));
      if (visibleLinks.length === 0) {
        return { success: false, message: 'No links found on this page.' };
      }

      const activeEl = document.activeElement;
      let currentIndex = -1;
      if (activeEl) {
        currentIndex = visibleLinks.indexOf(activeEl as HTMLElement);
      }

      const nextIdx = currentIndex >= 0 && currentIndex < visibleLinks.length - 1 ? currentIndex + 1 : 0;
      const targetLink = visibleLinks[nextIdx]!;

      targetLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightElement(targetLink);
      targetLink.focus();
      const text = computeAccessibleName(targetLink) || 'link';
      return { success: true, message: `Link: ${text}` };
    }

    if (type === 'navigate_landmark') {
      const landmarkType = action.landmarkType || 'main';
      let selector = '';
      if (landmarkType === 'main') {
        selector = 'main, [role="main"], article';
      } else if (landmarkType === 'navigation') {
        selector = 'nav, [role="navigation"]';
      } else if (landmarkType === 'search') {
        selector = '[role="search"], form[action*="search"], input[type="search"]';
      } else if (landmarkType === 'form') {
        selector = 'form, [role="form"]';
      }

      const landmark = selector ? (document.querySelector(selector) as HTMLElement | null) : null;
      if (!landmark) {
        return { success: false, message: `No ${landmarkType} landmark found on this page.` };
      }

      landmark.scrollIntoView({ behavior: 'smooth', block: 'start' });
      highlightElement(landmark);
      landmark.setAttribute('tabindex', '-1');
      landmark.focus();
      return { success: true, message: `Moved to ${landmarkType} landmark.` };
    }

    return { success: false, message: `Unknown action type: ${type}` };
  }

  function waitForPageSettle(timeoutMs: number = 3000, quietMs: number = 500): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let quietTimer: any = null;
      let observer: MutationObserver | null = null;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (quietTimer) clearTimeout(quietTimer);
        if (observer) observer.disconnect();
        resolve(true);
      };

      const maxTimer = setTimeout(() => {
        finish();
      }, timeoutMs);

      // Reset quiet timer on mutation
      const resetQuietTimer = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          clearTimeout(maxTimer);
          finish();
        }, quietMs);
      };

      try {
        observer = new MutationObserver(() => {
          resetQuietTimer();
        });

        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });

        // Initialize first quiet countdown
        resetQuietTimer();
      } catch {
        clearTimeout(maxTimer);
        finish();
      }
    });
  }

  // Runtime listener
  chrome.runtime.onMessage.addListener(
    (
      request: ExtensionMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      try {
        if (request.type === 'A11Y_PING') {
          sendResponse({ status: 'ok' });
          return true;
        }

        if (request.type === 'A11Y_SCAN_PAGE') {
          const result = scanAccessibilityTree();
          sendResponse(result);
          return true;
        }

        if (request.type === 'A11Y_WAIT_FOR_SETTLE') {
          const timeout = request.timeoutMs ?? 3000;
          const quiet = request.quietMs ?? 500;
          waitForPageSettle(timeout, quiet).then(() => {
            sendResponse({ settled: true });
          });
          return true;
        }

        if (request.type === 'A11Y_EXECUTE_ACTION') {
          const executionResult = executeAction(request.action);
          sendResponse(executionResult);
          return true;
        }

        if (request.type === 'A11Y_HIGHLIGHT') {
          const target =
            elementRegistry.get(Number(request.id)) ||
            (document.querySelector(`[${AGENT_ID_ATTR}="${request.id}"]`) as HTMLElement | null);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            highlightElement(target);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
          return true;
        }
        return false;
      } catch (err: any) {
        console.error('[a11y-pilot:content] Error handling message:', err);
        sendResponse({ success: false, error: err.message });
        return true;
      }
    }
  );

  console.log('[a11y-pilot] Content script initialized and ready.');
})();
