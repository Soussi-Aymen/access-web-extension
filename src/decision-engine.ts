/**
 * a11y-pilot: src/decision-engine.ts
 * Structured JSON dispatcher mapping natural language intents to specific element IDs.
 * Strict TypeScript implementation.
 */

import type {
  ActionableElement,
  DecisionPayload,
  PageScanPayload,
} from './types/index.js';

export class DecisionEngine {
  /**
   * Generates a warm, natural human summary of current page actions.
   * Example: "You are on [Site Name]. Would you like to search for a product or view your cart?"
   */
  public static generatePageSummary(pageContext: Partial<PageScanPayload>): string {
    const { siteName = 'the page', pageTitle = '', elements = [] } = pageContext;

    if (!elements || elements.length === 0) {
      return `You are on ${siteName}. I did not detect any interactive buttons or inputs here. You can ask me to scroll down or go back.`;
    }

    const searchbox = elements.find((el) => el.role === 'searchbox');

    // Priority keywords denoting primary website actions
    const priorityKeywords = [
      'cart', 'bag', 'basket', 'checkout', 'sign in', 'log in',
      'pricing', 'menu', 'submit', 'start', 'subscribe', 'buy',
      'products', 'explore', 'categories'
    ];

    const prioritizedActions: ActionableElement[] = [];

    for (const kw of priorityKeywords) {
      const match = elements.find(
        (el) =>
          (el.role === 'button' || el.role === 'link') &&
          el.name.toLowerCase().includes(kw) &&
          !prioritizedActions.some((a) => a.id === el.id)
      );
      if (match) {
        prioritizedActions.push(match);
      }
      if (prioritizedActions.length >= 2) break;
    }

    // Fallbacks
    if (prioritizedActions.length < 2) {
      const buttons = elements.filter(
        (el) => el.role === 'button' && !prioritizedActions.some((a) => a.id === el.id)
      );
      for (const btn of buttons) {
        prioritizedActions.push(btn);
        if (prioritizedActions.length >= 2) break;
      }
    }

    if (prioritizedActions.length < 2) {
      const links = elements.filter(
        (el) => el.role === 'link' && !prioritizedActions.some((a) => a.id === el.id)
      );
      for (const link of links) {
        prioritizedActions.push(link);
        if (prioritizedActions.length >= 2) break;
      }
    }

    const cleanActionName = (name: string): string => {
      return name
        .replace(/\(\d+\s*items?\)/i, '')
        .replace(/icon|btn|button/gi, '')
        .trim();
    };

    if (searchbox && prioritizedActions.length > 0) {
      const actionName = cleanActionName(prioritizedActions[0]!.name);
      return `You are on ${siteName}. Would you like to search for a product or ${
        actionName.toLowerCase().startsWith('view') ? actionName : `view your ${actionName}`
      }?`;
    }

    if (searchbox && prioritizedActions.length === 0) {
      return `You are on ${siteName}. Would you like to search, or hear the available navigation links?`;
    }

    if (prioritizedActions.length >= 2) {
      const first = cleanActionName(prioritizedActions[0]!.name);
      const second = cleanActionName(prioritizedActions[1]!.name);
      return `You are on ${siteName}. Would you like to ${first} or ${second}?`;
    }

    if (prioritizedActions.length === 1) {
      const first = cleanActionName(prioritizedActions[0]!.name);
      return `You are on ${siteName}. You can ${first}, or ask me to scroll down.`;
    }

    return `You are on ${siteName}: ${pageTitle}. What would you like to do?`;
  }

  /**
   * Dispatches user speech transcripts into structured JSON decision payloads.
   */
  public static parseIntent(
    userUtterance: string,
    elements: ActionableElement[] = [],
    context: Partial<PageScanPayload> = {}
  ): DecisionPayload {
    if (!userUtterance || !userUtterance.trim()) {
      return {
        intent: 'EMPTY',
        action: { type: 'none' },
        confidence: 0,
        explanation: 'Empty user transcript.',
        spokenResponse: 'I did not catch that. Could you please repeat?',
      };
    }

    const raw = userUtterance.trim();
    const text = raw.toLowerCase().replace(/[.,!?;:]/g, '');

    // 1. CANCEL / STOP / QUIET INTENT
    if (/^(stop|quiet|cancel|be quiet|shut up|hush|pause)$/i.test(text)) {
      return {
        intent: 'CANCEL',
        action: { type: 'none' },
        confidence: 1.0,
        explanation: 'User requested speech cancellation.',
        spokenResponse: '',
      };
    }

    // 2. HELP / SUMMARY / REPEAT INTENT
    if (
      /^(help|what can i do|where am i|summarize|options|what is on this page|repeat|menu)$/i.test(text) ||
      text.includes('what can i do') ||
      text.includes('where am i') ||
      text.includes('summarize the page')
    ) {
      const summary = DecisionEngine.generatePageSummary({
        siteName: context.siteName,
        pageTitle: context.pageTitle,
        elements,
      });
      return {
        intent: 'SUMMARY',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: 'User requested page summary or help.',
        spokenResponse: summary,
      };
    }

    // 3. SCROLL INTENT
    if (/scroll down|page down|go down|move down|read more/i.test(text)) {
      return {
        intent: 'SCROLL',
        action: { type: 'scroll', direction: 'down' },
        confidence: 0.95,
        explanation: 'Scrolling down the page.',
        spokenResponse: 'Scrolling down.',
      };
    }

    if (/scroll up|page up|go up|move up|back up/i.test(text)) {
      return {
        intent: 'SCROLL',
        action: { type: 'scroll', direction: 'up' },
        confidence: 0.95,
        explanation: 'Scrolling up the page.',
        spokenResponse: 'Scrolling up.',
      };
    }

    if (/scroll to top|top of page|go to top/i.test(text)) {
      return {
        intent: 'SCROLL',
        action: { type: 'scroll', direction: 'top' },
        confidence: 0.95,
        explanation: 'Scrolling to top of page.',
        spokenResponse: 'Scrolling to the top.',
      };
    }

    if (/scroll to bottom|bottom of page|go to bottom/i.test(text)) {
      return {
        intent: 'SCROLL',
        action: { type: 'scroll', direction: 'bottom' },
        confidence: 0.95,
        explanation: 'Scrolling to bottom of page.',
        spokenResponse: 'Scrolling to the bottom.',
      };
    }

    // 4. SEARCH INTENT
    // e.g. "search for vintage jackets", "find vintage jackets"
    const searchRegex = /^(?:please\s+)?(?:search(?:\s+for)?|find|look(?:\s+up|\s+for)|query(?:\s+for)?)\s+(.+)$/i;
    const searchMatch = text.match(searchRegex);

    if (searchMatch && searchMatch[1]) {
      const query = searchMatch[1].trim();

      let targetSearchEl = elements.find((el) => el.role === 'searchbox');
      if (!targetSearchEl) {
        targetSearchEl = elements.find(
          (el) =>
            el.role === 'textbox' &&
            (el.name.toLowerCase().includes('search') || el.name.toLowerCase().includes('query'))
        );
      }
      if (!targetSearchEl) {
        targetSearchEl = elements.find((el) => el.role === 'textbox');
      }

      if (targetSearchEl) {
        return {
          intent: 'SEARCH',
          action: {
            type: 'fill_and_submit',
            id: targetSearchEl.id,
            value: query,
            targetName: targetSearchEl.name,
          },
          confidence: 0.95,
          explanation: `Mapped search query "${query}" to element ${targetSearchEl.id} (${targetSearchEl.name}).`,
          spokenResponse: `Searching for ${query}.`,
        };
      } else {
        return {
          intent: 'SEARCH_NO_BOX',
          action: { type: 'none' },
          confidence: 0.7,
          explanation: 'Search intent detected but no searchbox found on page.',
          spokenResponse: `I heard your search for ${query}, but could not find a search box on this page.`,
        };
      }
    }

    // 5. FILL / INPUT INTENT
    const fillInMatch = text.match(/^(?:type|enter|input|write)\s+(.+?)\s+(?:in|into)\s+(.+)$/i);
    const fillWithMatch = text.match(/^fill\s+(.+?)\s+with\s+(.+)$/i);

    if (fillInMatch || fillWithMatch) {
      const value = (fillInMatch ? fillInMatch[1] : fillWithMatch![2])!.trim();
      const fieldDesc = (fillInMatch ? fillInMatch[2] : fillWithMatch![1])!.trim();

      const candidateInputs = elements.filter(
        (el) => el.role === 'textbox' || el.role === 'searchbox' || el.role === 'combobox'
      );

      const matchedField = DecisionEngine.findBestMatch(fieldDesc, candidateInputs);
      if (matchedField) {
        return {
          intent: 'FILL',
          action: {
            type: 'fill',
            id: matchedField.id,
            value: value,
            targetName: matchedField.name,
          },
          confidence: 0.9,
          explanation: `Entering "${value}" into ${matchedField.name} (ID: ${matchedField.id}).`,
          spokenResponse: `Entering ${value} into ${matchedField.name}.`,
        };
      }
    }

    // 6. DIRECT ID / NUMBER SELECTION INTENT
    const numberMatch = text.match(/(?:element|number|button|item|link|id|select|click)?\s*#?(\d+)/i);
    if (numberMatch && numberMatch[1]) {
      const requestedId = parseInt(numberMatch[1], 10);
      const targetById = elements.find((el) => el.id === requestedId);
      if (targetById) {
        return {
          intent: 'CLICK_BY_ID',
          action: {
            type: 'click',
            id: targetById.id,
            targetName: targetById.name,
          },
          confidence: 0.99,
          explanation: `Explicit element ID ${requestedId} requested (${targetById.name}).`,
          spokenResponse: `Clicking ${targetById.name}.`,
        };
      }
    }

    // 7. CLICK / SELECT INTENT
    const clickPrefixRegex = /^(?:please\s+)?(?:click(?:\s+on)?|open|press|view|go\s+to|select|choose|tap|check)\s+(.+)$/i;
    const clickPrefixMatch = text.match(clickPrefixRegex);
    const targetPhrase = (clickPrefixMatch ? clickPrefixMatch[1] : text)!.trim();

    const interactiveElements = elements.filter((el) =>
      ['button', 'link', 'checkbox', 'combobox'].includes(el.role)
    );

    const matchResult = DecisionEngine.findBestMatchWithScore(targetPhrase, interactiveElements);

    if (matchResult && matchResult.score >= 0.40) {
      const target = matchResult.element;
      return {
        intent: 'CLICK',
        action: {
          type: 'click',
          id: target.id,
          targetName: target.name,
        },
        confidence: matchResult.score,
        explanation: `Matched phrase "${targetPhrase}" to ${target.role} "${target.name}" with score ${matchResult.score.toFixed(2)}.`,
        spokenResponse: `Clicking ${target.name}.`,
      };
    }

    // 8. UNRESOLVED FALLBACK
    return {
      intent: 'UNKNOWN',
      action: { type: 'none' },
      confidence: 0.1,
      explanation: `Could not match "${userUtterance}" to a known page action.`,
      spokenResponse: `I heard "${userUtterance}", but couldn't find a matching action on this page. Say "help" to hear available options.`,
    };
  }

  public static scoreMatch(query: string, candidate: string): number {
    if (!query || !candidate) return 0;

    const q = query.toLowerCase().trim();
    const c = candidate.toLowerCase().trim();

    if (q === c) return 1.0;

    if (c.includes(q)) {
      return 0.85 + (q.length / c.length) * 0.1;
    }
    if (q.includes(c) && c.length >= 3) {
      return 0.75 + (c.length / q.length) * 0.1;
    }

    const qTokens = new Set(q.split(/\s+/).filter((t) => t.length > 1));
    const cTokens = new Set(c.split(/\s+/).filter((t) => t.length > 1));

    if (qTokens.size === 0 || cTokens.size === 0) return 0;

    let intersection = 0;
    for (const token of qTokens) {
      if (cTokens.has(token)) {
        intersection++;
      } else {
        for (const cToken of cTokens) {
          if (cToken.includes(token) || token.includes(cToken)) {
            intersection += 0.5;
            break;
          }
        }
      }
    }

    const union = new Set([...qTokens, ...cTokens]).size;
    return intersection / union;
  }

  public static findBestMatchWithScore(
    query: string,
    elements: ActionableElement[]
  ): { element: ActionableElement; score: number } | null {
    if (!query || elements.length === 0) return null;

    let best: ActionableElement | null = null;
    let highestScore = 0;

    for (const el of elements) {
      const score = DecisionEngine.scoreMatch(query, el.name);
      if (score > highestScore) {
        highestScore = score;
        best = el;
      }
    }

    if (best && highestScore > 0) {
      return { element: best, score: highestScore };
    }
    return null;
  }

  public static findBestMatch(
    query: string,
    elements: ActionableElement[]
  ): ActionableElement | null {
    const result = DecisionEngine.findBestMatchWithScore(query, elements);
    return result ? result.element : null;
  }
}
