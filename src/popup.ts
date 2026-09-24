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

  public async connectAndScanActiveTab(_isManualRescan: boolean = false): Promise<void> {
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

        const summary = DecisionEngine.generatePageSummary(this.pageContext);
        this.appendMessage('agent', summary);

        await this.voiceEngine.speak(summary);

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

  public async handleUserVoiceCommand(userUtterance: string): Promise<void> {
    this.appendMessage('user', userUtterance);
    this.updateStatus('processing', 'Processing...');

    const decision = DecisionEngine.parseIntent(
      userUtterance,
      this.currentElements,
      this.pageContext
    );

    console.log('[Popup:DecisionEngine] Structured Decision:', decision);

    if (decision.intent === 'CANCEL') {
      this.voiceEngine.cancel();
      this.updateStatus('listening', 'Listening...');
      return;
    }

    if (decision.action && decision.action.type !== 'none' && this.activeTabId) {
      try {
        const result: ActionResult = await chrome.tabs.sendMessage(this.activeTabId, {
          type: 'A11Y_EXECUTE_ACTION',
          action: decision.action,
        });

        if (result && !result.success) {
          console.warn('[Popup] Content action execution notice:', result.message);
        }
      } catch (err) {
        console.error('[Popup] Failed to send action to content script:', err);
      }
    }

    const speechResponse = decision.spokenResponse;
    if (speechResponse) {
      this.appendMessage('agent', speechResponse);
      await this.voiceEngine.speak(speechResponse);
    }

    if (decision.action && ['fill_and_submit', 'click'].includes(decision.action.type)) {
      setTimeout(() => {
        this.connectAndScanActiveTab();
      }, 1500);
    } else {
      if (this.isListening) {
        this.updateStatus('listening', 'Listening...');
      } else {
        this.updateStatus('ready', 'Ready');
      }
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
