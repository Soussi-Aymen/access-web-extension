/**
 * a11y-pilot: src/types/index.ts
 * Strongly typed models and message contracts.
 */

export type ActionableRole =
  | 'button'
  | 'link'
  | 'searchbox'
  | 'textbox'
  | 'combobox'
  | 'checkbox';

export interface ActionableElement {
  id: number;
  role: ActionableRole;
  name: string;
}

export interface PageScanPayload {
  siteName: string;
  pageTitle: string;
  url: string;
  elements: ActionableElement[];
  totalCount: number;
}

export type ActionType =
  | 'click'
  | 'fill'
  | 'fill_and_submit'
  | 'scroll'
  | 'focus'
  | 'none';

export type ScrollDirection = 'down' | 'up' | 'top' | 'bottom';

export interface AgentAction {
  type: ActionType;
  id?: number | null;
  value?: string | null;
  direction?: ScrollDirection | null;
  targetName?: string | null;
}

export type IntentType =
  | 'SEARCH'
  | 'SEARCH_NO_BOX'
  | 'CLICK'
  | 'CLICK_BY_ID'
  | 'FILL'
  | 'SCROLL'
  | 'SUMMARY'
  | 'CANCEL'
  | 'UNKNOWN'
  | 'EMPTY';

export interface DecisionPayload {
  intent: IntentType;
  action: AgentAction;
  confidence: number;
  explanation: string;
  spokenResponse: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
}

export interface VoiceEngineOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: (sentence: string) => void;
  onEnd?: () => void;
  onBoundary?: (text: string) => void;
}

export interface SpeakOptions {
  interrupt?: boolean;
  onSentenceStart?: (sentence: string) => void;
  onComplete?: () => void;
}

export interface VoiceQueueItem {
  text: string;
  isLast: boolean;
  onSentenceStart?: ((sentence: string) => void) | null;
  onComplete?: (() => void) | null;
}

// Chrome Message contracts
export type ExtensionMessage =
  | { type: 'A11Y_PING' }
  | { type: 'A11Y_SCAN_PAGE' }
  | { type: 'A11Y_EXECUTE_ACTION'; action: AgentAction }
  | { type: 'A11Y_HIGHLIGHT'; id: number };
