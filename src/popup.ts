/**
 * a11y-pilot: src/popup.ts
 * Primary Controller managing Web Speech API recognition, VoiceEngine natural speech synthesis,
 * DecisionEngine intent routing, and DOM state management.
 * 
 * Strict TypeScript implementation.
 */

import { VoiceEngine } from './voice-engine.js';
import { DecisionEngine } from './decision-engine.js';
import type {
  ActionableElement,
  ActionResult,
  AgentAction,
  PageScanPayload,
} from './types/index.js';

// Web Speech API interface declarations for TypeScript
interface IWindowSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: IWindowSpeechRecognition, ev: Event) => any) | null;
  onend: ((this: IWindowSpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: IWindowSpeechRecognition, ev: any) => any) | null;
  onresult: ((this: IWindowSpeechRecognition, ev: any) => any) | null;
  onspeechstart: ((this: IWindowSpeechRecognition, ev: Event) => any) | null;
  onsoundstart: ((this: IWindowSpeechRecognition, ev: Event) => any) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): IWindowSpeechRecognition };
    webkitSpeechRecognition?: { new (): IWindowSpeechRecognition };
    a11yPilot?: PopupController;
  }
}

export class PopupController {
  private voiceEngine: VoiceEngine;
  private recognition: IWindowSpeechRecognition | null = null;
  public isListening: boolean = false;
  private activeTabId: number | null = null;

  private currentElements: ActionableElement[] = [];
  private pageContext: Partial<PageScanPayload> = {
    siteName: '',
    pageTitle: '',
    url: '',
  };

  // Safety confirmation state
  private pendingConfirmAction: AgentAction | null = null;
  private confirmTimeoutId: any = null;

  // Voice macro recording state
  private recordingMacroName: string | null = null;
  private recordedCommands: string[] = [];

  private dom = {
    statusPill: document.getElementById('statusPill') as HTMLElement,
    statusText: document.getElementById('statusText') as HTMLElement,
    srAnnouncements: document.getElementById('srAnnouncements') as HTMLElement,
    micToggleBtn: document.getElementById('micToggleBtn') as HTMLButtonElement,
    micBtnLabel: document.getElementById('micBtnLabel') as HTMLElement,
    rescanBtn: document.getElementById('rescanBtn') as HTMLButtonElement,
    helpBtn: document.getElementById('helpBtn') as HTMLButtonElement,
    pageTitle: document.getElementById('pageTitle') as HTMLElement,
    actionCountBadge: document.getElementById('actionCountBadge') as HTMLElement,
    transcriptSection: document.getElementById('transcriptSection') as HTMLElement,
    actionsList: document.getElementById('actionsList') as HTMLElement,
    voiceSelect: document.getElementById('voiceSelect') as HTMLSelectElement,
    testVoiceBtn: document.getElementById('testVoiceBtn') as HTMLButtonElement,
    helpModal: document.getElementById('helpModal') as HTMLElement,
    closeModalBtn: document.getElementById('closeModalBtn') as HTMLButtonElement,
    versionBadge: document.getElementById('versionBadge') as HTMLElement,
  };

  constructor() {
    this.voiceEngine = new VoiceEngine({
      rate: 0.95,
      pitch: 1.0,
      onStart: () => this.updateStatus('speaking', 'Speaking...'),
      onEnd: () => {
        if (this.isListening) {
          this.updateStatus('listening', 'Listening...');
        } else {
          this.updateStatus('ready', 'Ready');
        }
      },
    });

    this.init();
  }

  private async init(): Promise<void> {
    if (this.dom.versionBadge) {
      try {
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) {
          this.dom.versionBadge.textContent = `v${manifest.version}`;
        }
      } catch {
        // Fallback to static text
      }
    }
    this.setupEventListeners();
    await this.initVoiceSelector();
    this.setupSpeechRecognition();
    await this.connectAndScanActiveTab();
  }

  private async initVoiceSelector(): Promise<void> {
    try {
      if (this.dom.voiceSelect) {
        this.dom.voiceSelect.value = this.voiceEngine.selectedVoiceId;
        this.dom.voiceSelect.addEventListener('change', () => {
          const val = this.dom.voiceSelect.value;
          if (val === 'system') {
            this.voiceEngine.useNeuralVoice = false;
          } else {
            this.voiceEngine.useNeuralVoice = true;
            this.voiceEngine.setNeuralVoice(val);
          }
        });
      }
      await this.voiceEngine.initVoices();
    } catch (err) {
      console.warn('[Popup] Voice init note:', err);
    }
  }

  private setupEventListeners(): void {
    this.dom.micToggleBtn.addEventListener('click', () => this.toggleListening());
    this.dom.rescanBtn.addEventListener('click', () => this.connectAndScanActiveTab(true));
    this.dom.helpBtn.addEventListener('click', () => this.openHelpModal());
    this.dom.closeModalBtn.addEventListener('click', () => this.closeHelpModal());
    this.dom.testVoiceBtn.addEventListener('click', () => this.testNaturalVoice());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dom.helpModal.classList.contains('is-open')) {
        this.closeHelpModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        this.toggleListening();
      }
    });
  }

  private setupSpeechRecognition(): void {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      this.announceSR('Speech Recognition is not supported in this browser.');
      this.dom.micToggleBtn.disabled = true;
      this.dom.micBtnLabel.textContent = 'Voice Input Unsupported';
      return;
    }

    this.recognition = new SpeechRecognitionClass();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.updateStatus('listening', 'Listening...');
      this.dom.micToggleBtn.classList.add('is-active');
      this.dom.micToggleBtn.setAttribute('aria-pressed', 'true');
      this.dom.micBtnLabel.textContent = 'Stop Listening';
      this.announceSR('Voice listening started. Speak your command.');
    };

    // CRITICAL: Cancel ongoing speech immediately upon user speech start
    this.recognition.onspeechstart = () => {
      console.log('[Popup] User speech detected. Cancelling speech output.');
      this.voiceEngine.cancel();
      if (this.isListening) {
        this.updateStatus('listening', 'Listening...');
      }
    };

    this.recognition.onsoundstart = () => {
      this.voiceEngine.cancel();
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcriptPart;
        } else {
          interimTranscript += transcriptPart;
        }
      }

      if (interimTranscript) {
        this.showInterimTranscript(interimTranscript);
      }

      if (finalTranscript && finalTranscript.trim()) {
        this.clearInterimTranscript();
        this.handleUserVoiceCommand(finalTranscript.trim());
      }
    };

    this.recognition.onerror = (event: any) => {
      console.warn('[Popup] Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        this.announceSR('Microphone access denied. Please allow microphone permissions.');
        this.appendMessage('agent', 'Microphone access is blocked. Please permit microphone usage in Chrome Settings.');
        this.stopListening();
      }
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        try {
          this.recognition?.start();
        } catch {
          // Already active
        }
      } else {
        this.dom.micToggleBtn.classList.remove('is-active');
        this.dom.micToggleBtn.setAttribute('aria-pressed', 'false');
        this.dom.micBtnLabel.textContent = 'Start Listening';
        this.updateStatus('ready', 'Ready');
      }
    };
  }

  public toggleListening(): void {
    if (!this.recognition) return;
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  public startListening(): void {
    if (!this.recognition) return;
    this.isListening = true;
    try {
      this.recognition.start();
    } catch {
      console.log('[Popup] Recognition already started');
    }
  }

  public stopListening(): void {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.voiceEngine.cancel();
    this.clearInterimTranscript();
    this.dom.micToggleBtn.classList.remove('is-active');
    this.dom.micToggleBtn.setAttribute('aria-pressed', 'false');
    this.dom.micBtnLabel.textContent = 'Start Listening';
    this.updateStatus('ready', 'Ready');
  }

  public async connectAndScanActiveTab(_isManualRescan: boolean = false, speakSummary: boolean = true): Promise<void> {
    this.updateStatus('processing', 'Scanning page...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        this.dom.pageTitle.textContent = 'No active tab found';
        this.updateStatus('ready', 'Ready');
        return;
      }

      this.activeTabId = tab.id;

      let response: PageScanPayload | undefined;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: 'A11Y_SCAN_PAGE' });
      } catch {
        console.log('[Popup] Injecting content script into active tab:', tab.id);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        response = await chrome.tabs.sendMessage(tab.id, { type: 'A11Y_SCAN_PAGE' });
      }

      if (response && response.elements) {
        this.currentElements = response.elements;
        this.pageContext = {
          siteName: response.siteName,
          pageTitle: response.pageTitle,
          url: response.url,
        };

        this.dom.pageTitle.textContent = `${response.siteName} — ${response.pageTitle}`;
        this.dom.pageTitle.title = response.pageTitle;
        this.dom.actionCountBadge.textContent = `${response.elements.length} actions`;

        this.renderActionsList(response.elements);
        this.updateStatus('ready', 'Ready');

        if (speakSummary) {
          const summary = DecisionEngine.generatePageSummary(this.pageContext);
          this.appendMessage('agent', summary);
          await this.voiceEngine.speak(summary);
        }

        if (!this.isListening) {
          this.startListening();
        }
      }
    } catch (err) {
      console.error('[Popup] Connection / Scan error:', err);
      this.dom.pageTitle.textContent = 'Cannot inspect this page';
      this.dom.actionCountBadge.textContent = '0 actions';
      this.dom.actionsList.innerHTML = `
        <div class="bubble-meta" style="padding: 12px; text-align: center; color: var(--danger);">
          Unable to inspect page. (Restricted browser page or missing permission)
        </div>
      `;
      this.updateStatus('ready', 'Ready');
    }
  }

  private async waitForPageToSettle(): Promise<void> {
    if (!this.activeTabId) return;
    try {
      await chrome.tabs.sendMessage(this.activeTabId, {
        type: 'A11Y_WAIT_FOR_SETTLE',
        timeoutMs: 3000,
        quietMs: 500,
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private clearConfirmation(): void {
    if (this.confirmTimeoutId) {
      clearTimeout(this.confirmTimeoutId);
      this.confirmTimeoutId = null;
    }
    this.pendingConfirmAction = null;
  }

  private async getSavedMacros(): Promise<Record<string, string[]>> {
    try {
      const result = await chrome.storage.local.get('a11y_macros');
      return (result && result.a11y_macros) || {};
    } catch {
      return {};
    }
  }

  private async saveMacros(macros: Record<string, string[]>): Promise<void> {
    try {
      await chrome.storage.local.set({ a11y_macros: macros });
    } catch (err) {
      console.warn('[Popup] Failed to save macros to chrome.storage.local:', err);
    }
  }

  public async handleUserVoiceCommand(userUtterance: string): Promise<void> {
    this.appendMessage('user', userUtterance);
    this.updateStatus('processing', 'Processing...');

    const trimmedLower = userUtterance.trim().toLowerCase().replace(/[.,!?;:]/g, '');

    // 1. Safety confirmation check if waiting for yes/no
    if (this.pendingConfirmAction) {
      if (/^(yes|confirm|proceed|ok|sure|do it)$/i.test(trimmedLower)) {
        const actionToExecute = this.pendingConfirmAction;
        this.clearConfirmation();

        if (this.activeTabId) {
          try {
            await chrome.tabs.sendMessage(this.activeTabId, {
              type: 'A11Y_EXECUTE_ACTION',
              action: actionToExecute,
            });
          } catch (err) {
            console.error('[Popup] Confirmation action execution error:', err);
          }
        }

        const msg = `Confirmed. ${actionToExecute.targetName ? `Action performed on ${actionToExecute.targetName}.` : 'Action performed.'}`;
        this.appendMessage('agent', msg);
        await this.voiceEngine.speak(msg);

        await this.waitForPageToSettle();
        await this.connectAndScanActiveTab(false, false);

        if (this.isListening) {
          this.updateStatus('listening', 'Listening...');
        } else {
          this.updateStatus('ready', 'Ready');
        }
        return;
      } else if (/^(no|cancel|stop|don't|dont|never mind)$/i.test(trimmedLower)) {
        this.clearConfirmation();
        const msg = 'Action cancelled.';
        this.appendMessage('agent', msg);
        await this.voiceEngine.speak(msg);
        if (this.isListening) {
          this.updateStatus('listening', 'Listening...');
        } else {
          this.updateStatus('ready', 'Ready');
        }
        return;
      }
    }

    const subCommands = DecisionEngine.splitUtteranceIntoCommands(
      userUtterance,
      this.currentElements,
      this.pageContext
    );

    for (let i = 0; i < subCommands.length; i++) {
      const stepText = subCommands[i]!;
      const stepNum = i + 1;

      const decision = DecisionEngine.parseSingleIntent(
        stepText,
        this.currentElements,
        this.pageContext
      );

      console.log(`[Popup:DecisionEngine] Step ${stepNum}/${subCommands.length}:`, stepText, decision);

      if (decision.intent === 'CANCEL') {
        this.clearConfirmation();
        this.voiceEngine.cancel();
        this.updateStatus('listening', 'Listening...');
        return;
      }

      // Handle MACRO intents
      if (decision.intent === 'MACRO') {
        const macroAct = decision.macroAction;
        if (macroAct === 'record_start' && decision.macroName) {
          this.recordingMacroName = decision.macroName.toLowerCase();
          this.recordedCommands = [];
          this.appendMessage('agent', decision.spokenResponse);
          await this.voiceEngine.speak(decision.spokenResponse);
          break;
        }

        if (macroAct === 'record_stop') {
          if (this.recordingMacroName) {
            const macros = await this.getSavedMacros();
            macros[this.recordingMacroName] = [...this.recordedCommands];
            await this.saveMacros(macros);
            const savedMsg = `Macro "${this.recordingMacroName}" saved with ${this.recordedCommands.length} ${this.recordedCommands.length === 1 ? 'command' : 'commands'}.`;
            this.recordingMacroName = null;
            this.recordedCommands = [];
            this.appendMessage('agent', savedMsg);
            await this.voiceEngine.speak(savedMsg);
          } else {
            const noRecMsg = 'No macro was being recorded.';
            this.appendMessage('agent', noRecMsg);
            await this.voiceEngine.speak(noRecMsg);
          }
          break;
        }

        if (macroAct === 'run' && decision.macroName) {
          const runName = decision.macroName.toLowerCase();
          const macros = await this.getSavedMacros();
          const macroCommands = macros[runName];

          if (!macroCommands || macroCommands.length === 0) {
            const notFoundMsg = `Macro "${decision.macroName}" not found. Say "list macros" to hear saved macros.`;
            this.appendMessage('agent', notFoundMsg);
            await this.voiceEngine.speak(notFoundMsg);
          } else {
            this.appendMessage('agent', `Running macro "${decision.macroName}" with ${macroCommands.length} steps.`);
            await this.voiceEngine.speak(`Running macro "${decision.macroName}".`);
            // Execute macro commands sequentially
            for (const macroStep of macroCommands) {
              await this.handleUserVoiceCommand(macroStep);
            }
          }
          break;
        }

        if (macroAct === 'list') {
          const macros = await this.getSavedMacros();
          const names = Object.keys(macros);
          const listMsg = names.length > 0
            ? `Saved macros: ${names.join(', ')}.`
            : 'No saved macros. Say "remember this as" followed by a name to create one.';
          this.appendMessage('agent', listMsg);
          await this.voiceEngine.speak(listMsg);
          break;
        }

        if (macroAct === 'delete' && decision.macroName) {
          const delName = decision.macroName.toLowerCase();
          const macros = await this.getSavedMacros();
          if (macros[delName]) {
            delete macros[delName];
            await this.saveMacros(macros);
            this.appendMessage('agent', decision.spokenResponse);
            await this.voiceEngine.speak(decision.spokenResponse);
          } else {
            const noMacroMsg = `Macro "${decision.macroName}" was not found.`;
            this.appendMessage('agent', noMacroMsg);
            await this.voiceEngine.speak(noMacroMsg);
          }
          break;
        }
      }

      // Handle CONFIRM intent for risky actions
      if (decision.intent === 'CONFIRM') {
        this.clearConfirmation();
        this.pendingConfirmAction = decision.action;

        // Auto-cancel on 10s of silence
        this.confirmTimeoutId = setTimeout(() => {
          if (this.pendingConfirmAction) {
            this.clearConfirmation();
            const timeoutMsg = 'Confirmation timed out. Action cancelled.';
            this.appendMessage('agent', timeoutMsg);
            this.voiceEngine.speak(timeoutMsg);
          }
        }, 10000);

        this.appendMessage('agent', decision.spokenResponse);
        await this.voiceEngine.speak(decision.spokenResponse);
        break;
      }

      if (decision.intent === 'UNKNOWN') {
        const failMessage = subCommands.length > 1
          ? `Step ${stepNum} failed: could not understand "${stepText}".`
          : decision.spokenResponse;
        this.appendMessage('agent', failMessage);
        await this.voiceEngine.speak(failMessage);
        break;
      }

      let actionSucceeded = true;
      if (decision.action && decision.action.type !== 'none' && this.activeTabId) {
        try {
          const result: ActionResult = await chrome.tabs.sendMessage(this.activeTabId, {
            type: 'A11Y_EXECUTE_ACTION',
            action: decision.action,
          });

          if (result && !result.success) {
            console.warn('[Popup] Content action execution notice:', result.message);
            actionSucceeded = false;
          }
        } catch (err) {
          console.error('[Popup] Failed to send action to content script:', err);
          actionSucceeded = false;
        }
      }

      if (!actionSucceeded) {
        const failMsg = `Step ${stepNum} failed: could not execute "${stepText}".`;
        this.appendMessage('agent', failMsg);
        await this.voiceEngine.speak(failMsg);
        break;
      }

      // Record successfully executed command if recording macro
      if (this.recordingMacroName) {
        this.recordedCommands.push(stepText);
      }

      // Speak response for the step (or default spokenResponse)
      if (decision.spokenResponse) {
        this.appendMessage('agent', decision.spokenResponse);
        await this.voiceEngine.speak(decision.spokenResponse);
      }

      // If more steps remain, wait for page to settle and re-scan without speaking full summary
      if (i < subCommands.length - 1) {
        await this.waitForPageToSettle();
        await this.connectAndScanActiveTab(false, false);
      } else {
        // Last step: if it was a click or submit, trigger settle and scan
        if (decision.action && ['fill_and_submit', 'click'].includes(decision.action.type)) {
          await this.waitForPageToSettle();
          await this.connectAndScanActiveTab(false, false);
        }
      }
    }

    if (this.isListening) {
      this.updateStatus('listening', 'Listening...');
    } else {
      this.updateStatus('ready', 'Ready');
    }
  }

  private renderActionsList(elements: ActionableElement[]): void {
    this.dom.actionsList.innerHTML = '';

    if (!elements || elements.length === 0) {
      this.dom.actionsList.innerHTML = `
        <div class="bubble-meta" style="padding: 12px; text-align: center;">
          No actionable elements found on this page.
        </div>
      `;
      return;
    }

    elements.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'action-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${item.role} ${item.name}, ID ${item.id}`);

      card.innerHTML = `
        <div class="action-card-left">
          <span class="agent-id-pill" title="Element ID">#${item.id}</span>
          <span class="role-badge">${item.role}</span>
          <span class="action-name" title="${item.name}">${item.name}</span>
        </div>
        <span class="bubble-meta">Say "Click ${item.id}"</span>
      `;

      card.addEventListener('click', () => {
        this.triggerManualAction(item);
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.triggerManualAction(item);
        }
      });

      this.dom.actionsList.appendChild(card);
    });
  }

  private async triggerManualAction(item: ActionableElement): Promise<void> {
    if (!this.activeTabId) return;

    const actionType = item.role === 'searchbox' ? 'focus' : 'click';
    await chrome.tabs.sendMessage(this.activeTabId, {
      type: 'A11Y_EXECUTE_ACTION',
      action: { type: actionType, id: item.id },
    });

    const responseText = `Triggered ${item.name}.`;
    this.appendMessage('agent', responseText);
    this.voiceEngine.speak(responseText);
  }

  public appendMessage(sender: 'user' | 'agent', text: string): void {
    const msgDiv = document.createElement('div');
    msgDiv.className = `transcript-message ${sender}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    const meta = document.createElement('span');
    meta.className = 'bubble-meta';
    meta.textContent = sender === 'user' ? 'You' : 'a11y-pilot';

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(meta);

    this.dom.transcriptSection.appendChild(msgDiv);
    this.dom.transcriptSection.scrollTop = this.dom.transcriptSection.scrollHeight;

    this.announceSR(`${sender === 'user' ? 'You said' : 'Assistant said'}: ${text}`);
  }

  private showInterimTranscript(text: string): void {
    let interimEl = document.getElementById('interimSpeechBubble');
    if (!interimEl) {
      interimEl = document.createElement('div');
      interimEl.id = 'interimSpeechBubble';
      interimEl.className = 'transcript-message user';
      interimEl.innerHTML = `<div class="bubble live-interim">...</div>`;
      this.dom.transcriptSection.appendChild(interimEl);
    }
    const bubble = interimEl.querySelector('.bubble');
    if (bubble) {
      bubble.textContent = `${text}...`;
    }
    this.dom.transcriptSection.scrollTop = this.dom.transcriptSection.scrollHeight;
  }

  private clearInterimTranscript(): void {
    const interimEl = document.getElementById('interimSpeechBubble');
    if (interimEl) {
      interimEl.remove();
    }
  }

  private updateStatus(stateClass: string, label: string): void {
    this.dom.statusPill.className = `status-pill ${stateClass}`;
    this.dom.statusText.textContent = label;
  }

  private announceSR(text: string): void {
    if (this.dom.srAnnouncements) {
      this.dom.srAnnouncements.textContent = text;
    }
  }

  public testNaturalVoice(): void {
    const sample = 'Hello! I am a11y-pilot. I inspect pages and help you browse the web conversationally.';
    this.appendMessage('agent', sample);
    this.voiceEngine.speak(sample);
  }

  public openHelpModal(): void {
    this.dom.helpModal.classList.add('is-open');
    this.dom.closeModalBtn.focus();
  }

  public closeHelpModal(): void {
    this.dom.helpModal.classList.remove('is-open');
    this.dom.helpBtn.focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.a11yPilot = new PopupController();
});
