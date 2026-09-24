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

export const SYNONYM_MAP: Record<string, string[]> = {
  cart: ['basket', 'bag', 'trolley', 'shopping cart', 'shopping bag'],
  basket: ['cart', 'bag', 'trolley'],
  bag: ['cart', 'basket'],
  'sign in': ['login', 'log in', 'signin'],
  'log in': ['signin', 'sign in', 'login'],
  login: ['sign in', 'log in', 'signin'],
  'sign out': ['logout', 'log out', 'signout'],
  'log out': ['signout', 'sign out', 'logout'],
  logout: ['sign out', 'log out', 'signout'],
  search: ['find', 'lookup', 'query', 'seek'],
  find: ['search', 'lookup', 'query'],
  menu: ['navigation', 'nav', 'hamburger', 'options'],
  navigation: ['menu', 'nav'],
  settings: ['preferences', 'config', 'configuration', 'options'],
  help: ['support', 'faq', 'customer service', 'assistance'],
  home: ['main', 'homepage'],
  buy: ['purchase', 'order', 'checkout', 'pay'],
  purchase: ['buy', 'order', 'checkout', 'pay'],
  pay: ['buy', 'purchase', 'checkout'],
};

export const RISKY_PATTERN = /\b(buy|pay|purchase|order|delete|remove|confirm|place\s+order)\b/i;

export class DecisionEngine {
  /**
   * Checks whether an actionable element represents a sensitive or risky action.
   */
  public static isRiskyAction(el: ActionableElement): boolean {
    if (el.isSubmit) return true;
    const textToCheck = `${el.name} ${el.nearbyText || ''} ${el.role}`.toLowerCase();
    return RISKY_PATTERN.test(textToCheck);
  }
  /**
   * Splits a chained utterance into separate sequential command strings.
   * Splits on "and then", "after that", "then", and "and" (when both sides parse as valid actions).
   */
  public static splitUtteranceIntoCommands(
    utterance: string,
    elements: ActionableElement[] = [],
    context: Partial<PageScanPayload> = {}
  ): string[] {
    if (!utterance || !utterance.trim()) return [];

    // Split on explicit sequence delimiters first: "and then", "after that", "then"
    const explicitParts = utterance.split(/\b(?:and\s+then|after\s+that|then)\b/i);
    const commands: string[] = [];

    for (const part of explicitParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check if this part contains " and " separating two valid commands
      const andParts = trimmed.split(/\band\b/i);
      if (andParts.length > 1) {
        // Try greedily splitting on 'and' only when segments resolve to actionable intents
        let currentGroup = '';
        for (let i = 0; i < andParts.length; i++) {
          const candidate = andParts[i]!.trim();
          if (!candidate) continue;

          if (!currentGroup) {
            currentGroup = candidate;
          } else {
            const testLeft = DecisionEngine.parseSingleIntent(currentGroup, elements, context);
            const testRight = DecisionEngine.parseSingleIntent(candidate, elements, context);

            const isLeftValid = testLeft.intent !== 'UNKNOWN' && testLeft.intent !== 'EMPTY';
            const isRightValid = testRight.intent !== 'UNKNOWN' && testRight.intent !== 'EMPTY';

            if (isLeftValid && isRightValid) {
              commands.push(currentGroup.trim());
              currentGroup = candidate;
            } else {
              currentGroup += ' and ' + candidate;
            }
          }
        }
        if (currentGroup.trim()) {
          commands.push(currentGroup.trim());
        }
      } else {
        commands.push(trimmed);
      }
    }

    return commands.length > 0 ? commands : [utterance.trim()];
  }
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
   * Builds heuristic "Where am I?" summary from page title, landmarks, headings, element counts, and main snippet.
   */
  public static buildWhereAmISummary(pageContext: Partial<PageScanPayload>): string {
    const { siteName = '', pageTitle = 'Current Page', elements = [], details } = pageContext;
    const parts: string[] = [];

    let titlePrefix: string;
    if (siteName && pageTitle) {
      titlePrefix = `${siteName}: ${pageTitle}`;
    } else {
      titlePrefix = siteName || pageTitle || 'this page';
    }

    parts.push(`You are on ${titlePrefix}.`);

    if (details) {
      if (details.landmarks && details.landmarks.length > 0) {
        parts.push(`Landmarks include ${details.landmarks.join(', ')}.`);
      }

      if (details.headings && details.headings.length > 0) {
        const topHeadings = details.headings.slice(0, 5).map((h) => `"${h}"`).join(', ');
        parts.push(`Key headings: ${topHeadings}.`);
      }

      const { links = 0, buttons = 0, inputs = 0 } = details.counts || {};
      const countParts: string[] = [];
      if (links > 0) countParts.push(`${links} ${links === 1 ? 'link' : 'links'}`);
      if (buttons > 0) countParts.push(`${buttons} ${buttons === 1 ? 'button' : 'buttons'}`);
      if (inputs > 0) countParts.push(`${inputs} ${inputs === 1 ? 'input field' : 'input fields'}`);

      if (countParts.length > 0) {
        parts.push(`The page has ${countParts.join(', ')}.`);
      }

      if (details.mainContentSnippet) {
        parts.push(details.mainContentSnippet);
      }
    } else if (elements.length > 0) {
      const buttons = elements.filter((e) => e.role === 'button').length;
      const links = elements.filter((e) => e.role === 'link').length;
      const inputs = elements.filter((e) => ['textbox', 'searchbox', 'combobox'].includes(e.role)).length;
      parts.push(`There are ${elements.length} actionable elements detected (${buttons} buttons, ${links} links, ${inputs} inputs).`);
    }

    return parts.join(' ');
  }

  /**
   * Dispatches a single user speech transcript into a structured JSON decision payload.
   */
  public static parseSingleIntent(
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

    // 1b. VOICE MACROS INTENTS
    // "remember this as <name>"
    const rememberMatch = text.match(/^(?:remember\s+this\s+as|save\s+macro\s+as|record\s+macro\s+as)\s+(.+)$/i);
    if (rememberMatch && rememberMatch[1]) {
      const name = rememberMatch[1].trim();
      return {
        intent: 'MACRO',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: `Starting macro recording for "${name}".`,
        spokenResponse: `Recording macro "${name}". Say your commands, then say "stop remembering" when done.`,
        macroAction: 'record_start',
        macroName: name,
      };
    }

    // "stop remembering"
    if (/^(stop remembering|finish macro|stop macro|save macro)$/i.test(text)) {
      return {
        intent: 'MACRO',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: 'Stopping macro recording.',
        spokenResponse: 'Macro saved.',
        macroAction: 'record_stop',
      };
    }

    // "run <name>"
    const runMatch = text.match(/^(?:run|play|execute)\s+(?:macro\s+)?(.+)$/i);
    if (runMatch && runMatch[1]) {
      const name = runMatch[1].trim();
      return {
        intent: 'MACRO',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: `Running macro "${name}".`,
        spokenResponse: `Running macro "${name}".`,
        macroAction: 'run',
        macroName: name,
      };
    }

    // "list macros"
    if (/^(list macros|what macros|show macros|available macros)$/i.test(text)) {
      return {
        intent: 'MACRO',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: 'Listing saved voice macros.',
        spokenResponse: '',
        macroAction: 'list',
      };
    }

    // "delete macro <name>"
    const deleteMatch = text.match(/^(?:delete|remove)\s+macro\s+(.+)$/i);
    if (deleteMatch && deleteMatch[1]) {
      const name = deleteMatch[1].trim();
      return {
        intent: 'MACRO',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: `Deleting macro "${name}".`,
        spokenResponse: `Deleted macro "${name}".`,
        macroAction: 'delete',
        macroName: name,
      };
    }

    // 2. WHERE AM I INTENT
    if (text.includes('where am i') || /^(where am i|tell me where i am)$/i.test(text)) {
      const summary = DecisionEngine.buildWhereAmISummary({
        siteName: context.siteName,
        pageTitle: context.pageTitle,
        elements,
        details: context.details,
      });
      return {
        intent: 'SUMMARY',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: 'User requested heuristic Where am I summary.',
        spokenResponse: summary,
      };
    }

    // 2b. HELP / SUMMARY / REPEAT INTENT
    if (
      /^(help|what can i do|summarize|options|what is on this page|repeat|menu)$/i.test(text) ||
      text.includes('what can i do') ||
      text.includes('summarize the page')
    ) {
      const summary = DecisionEngine.generatePageSummary({
        siteName: context.siteName,
        pageTitle: context.pageTitle,
        elements,
        details: context.details,
      });
      return {
        intent: 'SUMMARY',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: 'User requested page summary or help.',
        spokenResponse: summary,
      };
    }

    // 2c. SCREEN-READER STYLE NAVIGATION INTENTS
    // "next heading"
    if (/^(next heading|go to next heading)$/i.test(text)) {
      return {
        intent: 'CLICK',
        action: { type: 'navigate_heading', navDirection: 'next' },
        confidence: 0.95,
        explanation: 'Navigating to next heading.',
        spokenResponse: 'Next heading.',
      };
    }

    // "previous heading"
    if (/^(previous heading|prior heading|last heading|back to previous heading)$/i.test(text)) {
      return {
        intent: 'CLICK',
        action: { type: 'navigate_heading', navDirection: 'previous' },
        confidence: 0.95,
        explanation: 'Navigating to previous heading.',
        spokenResponse: 'Previous heading.',
      };
    }

    // "next link"
    if (/^(next link|go to next link)$/i.test(text)) {
      return {
        intent: 'CLICK',
        action: { type: 'navigate_link', navDirection: 'next' },
        confidence: 0.95,
        explanation: 'Navigating to next link.',
        spokenResponse: 'Next link.',
      };
    }

    // "list landmarks"
    if (/^(list landmarks|what landmarks|landmarks)$/i.test(text)) {
      const lms = context.details?.landmarks || [];
      const landmarkText = lms.length > 0
        ? `Landmarks on this page: ${lms.join(', ')}.`
        : 'No specific landmarks detected on this page.';
      return {
        intent: 'SUMMARY',
        action: { type: 'none' },
        confidence: 0.95,
        explanation: 'User requested list of landmarks.',
        spokenResponse: landmarkText,
      };
    }

    // "go to main"
    if (/^(go to main|jump to main|main content)$/i.test(text)) {
      return {
        intent: 'CLICK',
        action: { type: 'navigate_landmark', landmarkType: 'main' },
        confidence: 0.95,
        explanation: 'Navigating to main landmark.',
        spokenResponse: 'Going to main content.',
      };
    }

    // "go to navigation"
    if (/^(go to navigation|jump to navigation|navigation landmark|go to menu)$/i.test(text)) {
      return {
        intent: 'CLICK',
        action: { type: 'navigate_landmark', landmarkType: 'navigation' },
        confidence: 0.95,
        explanation: 'Navigating to navigation landmark.',
        spokenResponse: 'Going to navigation.',
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
        if (DecisionEngine.isRiskyAction(targetById)) {
          return {
            intent: 'CONFIRM',
            action: {
              type: 'click',
              id: targetById.id,
              targetName: targetById.name,
            },
            confidence: 0.99,
            explanation: `Risky action detected for element ${targetById.id} (${targetById.name}).`,
            spokenResponse: `Are you sure you want to ${targetById.name}? Say yes to confirm or no to cancel.`,
            requiresConfirmation: true,
          };
        }

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

    const rankedMatches = DecisionEngine.rankMatches(targetPhrase, interactiveElements);

    if (rankedMatches.length > 0 && rankedMatches[0]!.score >= 0.40) {
      const bestMatch = rankedMatches[0]!;

      // Disambiguation: if second candidate is close (within 0.08 and above 0.38)
      if (rankedMatches.length > 1) {
        const secondMatch = rankedMatches[1]!;
        if (bestMatch.score - secondMatch.score <= 0.08 && secondMatch.score >= 0.38) {
          const el1 = bestMatch.element;
          const el2 = secondMatch.element;
          const askMsg = `Did you mean #${el1.id} ${el1.name} or #${el2.id} ${el2.name}? Say the number.`;
          return {
            intent: 'DISAMBIGUATE',
            action: { type: 'none' },
            confidence: bestMatch.score,
            explanation: `Close match between element ${el1.id} and ${el2.id}.`,
            spokenResponse: askMsg,
            ambiguousCandidates: [el1, el2],
          };
        }
      }

      const target = bestMatch.element;

      if (DecisionEngine.isRiskyAction(target)) {
        return {
          intent: 'CONFIRM',
          action: {
            type: 'click',
            id: target.id,
            targetName: target.name,
          },
          confidence: bestMatch.score,
          explanation: `Risky action detected for element "${target.name}".`,
          spokenResponse: `Are you sure you want to ${target.name}? Say yes to confirm or no to cancel.`,
          requiresConfirmation: true,
        };
      }

      return {
        intent: 'CLICK',
        action: {
          type: 'click',
          id: target.id,
          targetName: target.name,
        },
        confidence: bestMatch.score,
        explanation: `Matched phrase "${targetPhrase}" to ${target.role} "${target.name}" with score ${bestMatch.score.toFixed(2)}.`,
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

  /**
   * Dispatches user speech transcript into a structured JSON decision payload.
   */
  public static parseIntent(
    userUtterance: string,
    elements: ActionableElement[] = [],
    context: Partial<PageScanPayload> = {}
  ): DecisionPayload {
    return DecisionEngine.parseSingleIntent(userUtterance, elements, context);
  }

  /**
   * Expands a set of tokens with their synonyms from SYNONYM_MAP.
   */
  public static expandSynonyms(tokens: Iterable<string>): Set<string> {
    const expanded = new Set<string>();
    for (const token of tokens) {
      expanded.add(token);
      if (SYNONYM_MAP[token]) {
        for (const syn of SYNONYM_MAP[token]!) {
          for (const st of syn.split(/\s+/)) {
            if (st) expanded.add(st);
          }
        }
      }
    }
    return expanded;
  }

  /**
   * Scores match between user query and candidate string or element name using token overlap & synonyms.
   */
  public static scoreMatch(query: string, candidate: string): number {
    if (!query || !candidate) return 0;

    const q = query.toLowerCase().trim();
    const c = candidate.toLowerCase().trim();

    if (q === c) return 1.0;

    // Check direct phrase synonym match
    if (SYNONYM_MAP[q] && SYNONYM_MAP[q]!.some((syn) => syn === c || c.includes(syn))) {
      return 0.95;
    }
    if (SYNONYM_MAP[c] && SYNONYM_MAP[c]!.some((syn) => syn === q || q.includes(syn))) {
      return 0.95;
    }

    if (c.includes(q)) {
      return 0.85 + (q.length / c.length) * 0.1;
    }
    if (q.includes(c) && c.length >= 3) {
      return 0.75 + (c.length / q.length) * 0.1;
    }

    const qTokens = new Set(q.split(/\s+/).filter((t) => t.length > 1));
    const cTokens = new Set(c.split(/\s+/).filter((t) => t.length > 1));

    if (qTokens.size === 0 || cTokens.size === 0) return 0;

    const expandedQTokens = DecisionEngine.expandSynonyms(qTokens);
    const expandedCTokens = DecisionEngine.expandSynonyms(cTokens);

    let intersection = 0;
    for (const token of qTokens) {
      if (expandedCTokens.has(token)) {
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

    const union = new Set([...expandedQTokens, ...expandedCTokens]).size;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Scores candidate element by accessible name, role, and nearby text.
   */
  public static scoreElementMatch(query: string, el: ActionableElement): number {
    const nameScore = DecisionEngine.scoreMatch(query, el.name);
    let totalScore = nameScore * 0.8;

    // Bonus for matching role mention (e.g. query mentions "button" and el.role === 'button')
    const qLower = query.toLowerCase();
    if (qLower.includes(el.role)) {
      totalScore += 0.1;
    }

    // Nearby text token overlap bonus
    if (el.nearbyText) {
      const nearbyScore = DecisionEngine.scoreMatch(query, el.nearbyText);
      if (nearbyScore > 0) {
        totalScore += Math.min(nearbyScore * 0.1, 0.1);
      }
    }

    return Math.min(totalScore, 1.0);
  }

  public static rankMatches(
    query: string,
    elements: ActionableElement[]
  ): Array<{ element: ActionableElement; score: number }> {
    if (!query || elements.length === 0) return [];

    const scored = elements.map((el) => ({
      element: el,
      score: DecisionEngine.scoreElementMatch(query, el),
    }));

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  public static findBestMatchWithScore(
    query: string,
    elements: ActionableElement[]
  ): { element: ActionableElement; score: number } | null {
    const ranked = DecisionEngine.rankMatches(query, elements);
    return ranked.length > 0 ? ranked[0]! : null;
  }

  public static findBestMatch(
    query: string,
    elements: ActionableElement[]
  ): ActionableElement | null {
    const result = DecisionEngine.findBestMatchWithScore(query, elements);
    return result ? result.element : null;
  }
}
