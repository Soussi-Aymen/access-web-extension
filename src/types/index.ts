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
  nearbyText?: string;
  isSubmit?: boolean;
}

export interface PageSummaryDetails {
  landmarks: string[];
  headings: string[];
  counts: {
    links: number;
    buttons: number;
    inputs: number;
  };
  mainContentSnippet?: string;
}

export interface PageScanPayload {
  siteName: string;
  pageTitle: string;
  url: string;
  elements: ActionableElement[];
  totalCount: number;
  details?: PageSummaryDetails;
}

export type ActionType =
  | 'click'
  | 'fill'
  | 'fill_and_submit'
  | 'scroll'
  | 'focus'
  | 'navigate_heading'
  | 'navigate_link'
  | 'navigate_landmark'
  | 'none';

export type ScrollDirection = 'down' | 'up' | 'top' | 'bottom';

export interface AgentAction {
  type: ActionType;
  id?: number | null;
  value?: string | null;
  direction?: ScrollDirection | null;
  targetName?: string | null;
  navDirection?: 'next' | 'previous';
  landmarkType?: 'main' | 'navigation' | 'search' | 'form';
}

export type IntentType =
  | 'SEARCH'
  | 'SEARCH_NO_BOX'
  | 'CLICK'
  | 'CLICK_BY_ID'
  | 'DISAMBIGUATE'
  | 'CONFIRM'
  | 'MACRO'
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
  ambiguousCandidates?: ActionableElement[];
  requiresConfirmation?: boolean;
  macroAction?: 'record_start' | 'record_stop' | 'run' | 'list' | 'delete';
  macroName?: string;
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

export type ExtensionMessage =
  | { type: 'A11Y_PING' }
  | { type: 'A11Y_SCAN_PAGE' }
  | { type: 'A11Y_EXECUTE_ACTION'; action: AgentAction }
  | { type: 'A11Y_HIGHLIGHT'; id: number }
  | { type: 'A11Y_WAIT_FOR_SETTLE'; timeoutMs?: number; quietMs?: number };
