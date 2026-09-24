/**
 * a11y-pilot: src/voice-engine.ts
 * Dedicated audio module ensuring warm, natural, human-sounding speech output.
 * 
 * Strict TypeScript implementation with:
 * - Ultra-realistic Microsoft Neural TTS (Aria / Guy / Jenny) as primary high-fidelity engine.
 * - Automatic seamless fallback to browser Web Speech API (SpeechSynthesis).
 * - Asynchronous voice discovery with voiceschanged fallback.
 * - Strict voice priority filtering (Microsoft Natural -> Google Natural -> OS Enhanced).
 * - Calibrated rate (0.95) and pitch (1.0) for natural conversational cadence.
 * - Sentence-level queuing with instant interruption / abort handling.
 */

import type { SpeakOptions, VoiceEngineOptions, VoiceQueueItem } from './types/index.js';
import { EdgeTTS, NEURAL_VOICES, type EdgeVoice } from './edge-tts.ts';
import { GoogleTTS, GOOGLE_NEURAL_VOICES, type GoogleVoice } from './google-tts.ts';

export type { EdgeVoice, GoogleVoice };

export interface NeuralVoiceOption {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  locale: string;
  engine: 'google' | 'edge';
}

export const ALL_NEURAL_VOICES: NeuralVoiceOption[] = [
  ...GOOGLE_NEURAL_VOICES.map((v) => ({ ...v, engine: 'google' as const })),
  ...NEURAL_VOICES.map((v) => ({ ...v, engine: 'edge' as const })),
];

export class VoiceEngine {
  private synth: SpeechSynthesis | null = null;
  public rate: number;
  public pitch: number;
  public volume: number;

  public googleTTS: GoogleTTS = new GoogleTTS();
  public edgeTTS: EdgeTTS = new EdgeTTS();
  public selectedVoiceId: string = 'system';
  public useNeuralVoice: boolean = false;

  private selectedVoice: SpeechSynthesisVoice | null = null;
  private availableVoices: SpeechSynthesisVoice[] = [];
  private voiceReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null;

  // Queue state for Web Speech API fallback
  private queue: VoiceQueueItem[] = [];
  public isSpeaking: boolean = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  // Callbacks
  private onStartCallback: ((sentence: string) => void) | null = null;
  private onEndCallback: (() => void) | null = null;
  private onBoundaryCallback: ((text: string) => void) | null = null;

  constructor(options: VoiceEngineOptions = {}) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }

    this.rate = options.rate !== undefined ? options.rate : 0.95;
    this.pitch = options.pitch !== undefined ? options.pitch : 1.0;
    this.volume = options.volume !== undefined ? options.volume : 1.0;

    this.onStartCallback = options.onStart ?? null;
    this.onEndCallback = options.onEnd ?? null;
    this.onBoundaryCallback = options.onBoundary ?? null;

    this.initVoices();
  }

  /**
   * Initializes and waits for speech synthesis voices to be loaded asynchronously.
   */
  public initVoices(): Promise<SpeechSynthesisVoice[]> {
    if (this.voiceReadyPromise) {
      return this.voiceReadyPromise;
    }

    this.voiceReadyPromise = new Promise((resolve) => {
      if (!this.synth) {
        return resolve([]);
      }

      const immediateVoices = this.synth.getVoices();
      if (immediateVoices && immediateVoices.length > 0) {
        this.availableVoices = immediateVoices;
        this.selectedVoice = this.pickBestVoice(immediateVoices);
        return resolve(immediateVoices);
      }

      const onVoicesChanged = () => {
        if (!this.synth) return resolve([]);
        const loadedVoices = this.synth.getVoices();
        if (loadedVoices && loadedVoices.length > 0) {
          this.availableVoices = loadedVoices;
          this.selectedVoice = this.pickBestVoice(loadedVoices);
          if (this.synth.removeEventListener) {
            this.synth.removeEventListener('voiceschanged', onVoicesChanged);
          } else {
            this.synth.onvoiceschanged = null;
          }
          resolve(loadedVoices);
        }
      };

      if (this.synth.addEventListener) {
        this.synth.addEventListener('voiceschanged', onVoicesChanged);
      } else {
        this.synth.onvoiceschanged = onVoicesChanged;
      }

      // Fallback timeout in case voiceschanged does not trigger
      setTimeout(() => {
        const fallbackVoices = this.synth ? this.synth.getVoices() : [];
        this.availableVoices = fallbackVoices;
        this.selectedVoice = this.pickBestVoice(this.availableVoices);
        resolve(this.availableVoices);
      }, 750);
    });

    return this.voiceReadyPromise;
  }

  /**
   * Returns list of neural voices available.
   */
  public getNeuralVoices(): NeuralVoiceOption[] {
    return ALL_NEURAL_VOICES;
  }

  /**
   * Sets the active neural voice.
   */
  public setNeuralVoice(voiceId: string): boolean {
    const googleVoice = GOOGLE_NEURAL_VOICES.find((v) => v.id === voiceId);
    if (googleVoice) {
      this.selectedVoiceId = voiceId;
      this.googleTTS.selectedLocale = googleVoice.locale;
      return true;
    }

    const edgeVoice = NEURAL_VOICES.find((v) => v.id === voiceId);
    if (edgeVoice) {
      this.selectedVoiceId = voiceId;
      this.edgeTTS.selectedVoiceId = voiceId;
      return true;
    }

    return false;
  }

  /**
   * Returns a user-friendly label of the currently active voice.
   */
  public getActiveVoiceLabel(): string {
    if (this.useNeuralVoice) {
      const v = ALL_NEURAL_VOICES.find((voice) => voice.id === this.selectedVoiceId);
      if (v) return v.name;
      const edgeV = NEURAL_VOICES.find((voice) => voice.id === this.edgeTTS.selectedVoiceId);
      return edgeV ? edgeV.name : 'Google Natural (US Neural)';
    }
    return this.selectedVoice ? `${this.selectedVoice.name} (${this.selectedVoice.lang})` : 'System Default';
  }

  /**
   * Prioritizes natural-sounding free voices in strict hierarchy for local fallback:
   * 1. Voices containing "Natural" (e.g., Microsoft Aria/Guy Online Natural)
   * 2. Voices containing "Google US English" or "Google UK English Female"
   * 3. Premium or Enhanced OS voices (e.g., Samantha, Daniel on macOS)
   * 4. Any English Google voice
   * 5. Any English voice
   * 6. Fallback to system default
   */
  public pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (!voices || voices.length === 0) {
      return null;
    }

    const englishVoices = voices.filter(
      (v) => v.lang && v.lang.toLowerCase().startsWith('en')
    );
    const candidatePool = englishVoices.length > 0 ? englishVoices : voices;

    // Tier 1: Microsoft "Natural" neural voices
    const naturalVoice = candidatePool.find((v) =>
      v.name.toLowerCase().includes('natural')
    );
    if (naturalVoice) {
      return naturalVoice;
    }

    // Tier 2: Google US English or Google UK English Female
    const googleSpecificVoice = candidatePool.find((v) => {
      const name = v.name.toLowerCase();
      return (
        name.includes('google us english') ||
        name.includes('google uk english female')
      );
    });
    if (googleSpecificVoice) {
      return googleSpecificVoice;
    }

    // Tier 3: Premium or Enhanced OS voices (Samantha, Daniel, etc.)
    const enhancedVoice = candidatePool.find((v) => {
      const name = v.name.toLowerCase();
      return (
        name.includes('enhanced') ||
        name.includes('premium') ||
        name.includes('samantha') ||
        name.includes('daniel') ||
        name.includes('siri')
      );
    });
    if (enhancedVoice) {
      return enhancedVoice;
    }

    // Tier 4: Any Google voice
    const anyGoogleVoice = candidatePool.find((v) =>
      v.name.toLowerCase().includes('google')
    );
    if (anyGoogleVoice) {
      return anyGoogleVoice;
    }

    // Tier 5: Default English voice
    const defaultEn = candidatePool.find((v) => v.default) ?? candidatePool[0];
    if (defaultEn) {
      return defaultEn;
    }

    return voices[0] ?? null;
  }

  public setVoice(voiceURIOrName: string): boolean {
    const found = this.availableVoices.find(
      (v) => v.voiceURI === voiceURIOrName || v.name === voiceURIOrName
    );
    if (found) {
      this.selectedVoice = found;
      return true;
    }
    return false;
  }

  public splitIntoSentences(text: string): string[] {
    if (!text) return [];
    return text
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .trim()
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Speaks the provided text naturally with neural synthesis and sentence queueing fallback.
   */
  public async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const {
      interrupt = true,
      onSentenceStart = undefined,
      onComplete = undefined,
    } = options;

    if (!text || !text.trim()) {
      if (onComplete) onComplete();
      return;
    }

    if (interrupt) {
      this.cancel();
    }

    // 1. Primary: Natural Neural Speech Synthesis (Google WaveNet / Edge Neural)
    if (this.useNeuralVoice && typeof window !== 'undefined') {
      const selectedVoice = ALL_NEURAL_VOICES.find((v) => v.id === this.selectedVoiceId);
      const isEdgeRequested = selectedVoice && selectedVoice.engine === 'edge';

      // If user explicitly picked an Edge voice, try EdgeTTS first
      if (isEdgeRequested && 'WebSocket' in window) {
        try {
          this.isSpeaking = true;
          if (this.onStartCallback) this.onStartCallback(text);
          if (onSentenceStart) onSentenceStart(text);

          await this.edgeTTS.speak(text, {
            rate: this.rate,
            voiceId: this.selectedVoiceId,
            onStart: () => {
              this.isSpeaking = true;
            },
            onEnd: () => {
              this.isSpeaking = false;
              if (this.onEndCallback) this.onEndCallback();
              if (onComplete) onComplete();
            },
          });
          return;
        } catch (edgeErr) {
          console.warn('[VoiceEngine] Edge TTS failed, falling back to local speech synthesis:', edgeErr);
          this.edgeTTS.stop();
          this.isSpeaking = false;
          return this.speakLocal(text, options);
        }
      }

      // Google Natural WaveNet Neural Voice (super warm, realistic, works on Chrome / Chromium / Linux)
      try {
        this.isSpeaking = true;
        if (this.onStartCallback) this.onStartCallback(text);
        if (onSentenceStart) onSentenceStart(text);

        const locale = selectedVoice ? selectedVoice.locale : 'en-US';
        await this.googleTTS.speak(text, {
          rate: this.rate,
          volume: this.volume,
          locale,
          onStart: () => {
            this.isSpeaking = true;
          },
          onEnd: () => {
            this.isSpeaking = false;
            if (this.onEndCallback) this.onEndCallback();
            if (onComplete) onComplete();
          },
        });
        return;
      } catch (googleErr) {
        console.warn('[VoiceEngine] Natural Neural speech stream note, using Web Speech API fallback:', googleErr);
        this.googleTTS.stop();
        this.isSpeaking = false;
      }
    }

    // 2. Fallback: Browser local Web Speech API (if completely offline)
    return this.speakLocal(text, options);
  }

  /**
   * Local SpeechSynthesis playback queue.
   */
  private async speakLocal(text: string, options: SpeakOptions = {}): Promise<void> {
    const {
      onSentenceStart = undefined,
      onComplete = undefined,
    } = options;

    await this.initVoices();

    const sentences = this.splitIntoSentences(text);
    if (sentences.length === 0) {
      if (onComplete) onComplete();
      return;
    }

    return new Promise<void>((resolve) => {
      sentences.forEach((sentence, index) => {
        const isLast = index === sentences.length - 1;
        this.queue.push({
          text: sentence,
          isLast,
          onSentenceStart,
          onComplete: isLast
            ? () => {
                if (onComplete) onComplete();
                resolve();
              }
            : null,
        });
      });

      if (!this.isSpeaking) {
        this.processNextInQueue();
      }
    });
  }

  private processNextInQueue(): void {
    if (!this.synth || this.queue.length === 0) {
      this.isSpeaking = false;
      this.currentUtterance = null;
      if (this.onEndCallback) {
        this.onEndCallback();
      }
      return;
    }

    const item = this.queue.shift()!;
    this.isSpeaking = true;

    if (this.onStartCallback && this.queue.length === 0) {
      this.onStartCallback(item.text);
    }

    const utterance = new SpeechSynthesisUtterance(item.text);
    this.currentUtterance = utterance;

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
      utterance.lang = this.selectedVoice.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }

    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    utterance.volume = this.volume;

    utterance.onstart = () => {
      if (item.onSentenceStart) {
        item.onSentenceStart(item.text);
      }
      if (this.onBoundaryCallback) {
        this.onBoundaryCallback(item.text);
      }
    };

    utterance.onend = () => {
      if (item.onComplete) {
        item.onComplete();
      }
      this.processNextInQueue();
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.warn('[VoiceEngine] Local speech synthesis error:', event.error);
      }
      if (item.onComplete) {
        item.onComplete();
      }
      this.processNextInQueue();
    };

    if (this.synth.paused) {
      this.synth.resume();
    }

    this.synth.speak(utterance);
  }

  /**
   * Instantly stops speech synthesis and clears both neural and local queues.
   */
  public cancel(): void {
    this.googleTTS.stop();
    this.edgeTTS.stop();
    this.queue = [];
    if (this.synth) {
      this.synth.cancel();
    }
    this.isSpeaking = false;
    this.currentUtterance = null;
    if (this.onEndCallback) {
      this.onEndCallback();
    }
  }

  public pause(): void {
    if (this.googleTTS.getIsPlaying()) {
      this.googleTTS.stop();
    }
    if (this.edgeTTS.getIsPlaying()) {
      this.edgeTTS.stop();
    }
    if (this.synth && this.isSpeaking) {
      this.synth.pause();
    }
  }

  public resume(): void {
    if (this.synth && this.synth.paused) {
      this.synth.resume();
    }
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return this.availableVoices;
  }

  public getCurrentVoice(): SpeechSynthesisVoice | null {
    return this.selectedVoice;
  }

  public getCurrentUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }
}
