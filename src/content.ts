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

  const elementRegistry = new Map<number, HTMLElement>();

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
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearExistingAgentIds(): void {
    const existing = document.querySelectorAll(`[${AGENT_ID_ATTR}]`);
    existing.forEach((el) => el.removeAttribute(AGENT_ID_ATTR));
    elementRegistry.clear();
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

      el.setAttribute(AGENT_ID_ATTR, String(currentId));
      elementRegistry.set(currentId, el);

      extracted.push({
        id: currentId,
        role,
        name: name || `${role} ${currentId}`,
      });

      currentId++;

      if (extracted.length >= 75) {
        break;
      }
    }

    return {
      siteName: getNaturalSiteName(),
      pageTitle: document.title || 'Current Webpage',
      url: window.location.href,
      elements: extracted,
      totalCount: extracted.length,
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

    return { success: false, message: `Unknown action type: ${type}` };
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
