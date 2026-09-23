/**
 * a11y-pilot: src/edge-tts.ts
 * High-fidelity, human-like neural text-to-speech synthesis using free online neural voices.
 * 
 * Strict TypeScript implementation with:
 * - Dynamic Sec-MS-GEC DRM token generation using SHA-256 and Windows FileTime epoch.
 * - WebSocket streaming of 24kHz MP3 audio packets.
 * - Audio element lifecycle management with instant interruption and cancellation.
 */

export interface EdgeVoice {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  locale: string;
}

export const NEURAL_VOICES: EdgeVoice[] = [
  { id: 'en-US-AriaNeural', name: 'Aria (Natural Neural)', gender: 'Female', locale: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy (Natural Neural)', gender: 'Male', locale: 'en-US' },
  { id: 'en-US-JennyNeural', name: 'Jenny (Natural Neural)', gender: 'Female', locale: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (British Neural)', gender: 'Female', locale: 'en-GB' },
];

export class EdgeTTS {
  private static readonly CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  private static readonly WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
  private static readonly SEC_MS_GEC_VERSION = '1-143.0.3650.96';
  private static readonly WIN_EPOCH = 11644473600;

  private currentAudio: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private activeWs: WebSocket | null = null;
  private isPlaying: boolean = false;

  public selectedVoiceId: string = 'en-US-AriaNeural';

  /**
   * Generates the dynamic Sec-MS-GEC token required by the Microsoft Speech API.
   */
  public static async generateSecMsGec(trustedClientToken: string = EdgeTTS.CLIENT_TOKEN): Promise<string> {
    const unixSeconds = Math.floor(Date.now() / 1000);
    let ticks = unixSeconds + EdgeTTS.WIN_EPOCH;
    ticks -= ticks % 300; // Round down to 5-minute interval
    const windowsTicks = BigInt(ticks) * 10000000n; // Convert to 100-nanosecond intervals

    const dataToHash = `${windowsTicks.toString()}${trustedClientToken}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(dataToHash);

    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /**
   * Generates random 32-character hexadecimal UUID without hyphens.
   */
  public static generateId(): string {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /**
   * Escapes XML characters for SSML safety.
   */
  private static escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Synthesizes text into an MP3 audio Blob via WebSocket.
   */
  public async synthesize(
    text: string,
    voiceId: string = this.selectedVoiceId,
    rate: number = 1.0
  ): Promise<Blob> {
    if (!text || !text.trim()) {
      throw new Error('Text cannot be empty.');
    }

    const secMsGec = await EdgeTTS.generateSecMsGec();
    const connectionId = EdgeTTS.generateId();
    const requestId = EdgeTTS.generateId();

    const url = `${EdgeTTS.WSS_URL}?TrustedClientToken=${EdgeTTS.CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${EdgeTTS.SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;

    return new Promise<Blob>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.activeWs = ws;
      ws.binaryType = 'arraybuffer';

      const audioChunks: BlobPart[] = [];
      let isCompleted = false;

      const timeoutId = setTimeout(() => {
        if (!isCompleted) {
          isCompleted = true;
          try { ws.close(); } catch {}
          reject(new Error('Edge TTS request timed out.'));
        }
      }, 10000);

      ws.onopen = () => {
        // 1. Send speech.config
        const configMsg =
          'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: 'false',
                    wordBoundaryEnabled: 'false',
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          });
        ws.send(configMsg);

        // 2. Format rate percentage (e.g. 0.95 -> -5%)
        const ratePercent = Math.round((rate - 1.0) * 100);
        const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

        // 3. Send SSML
        const escapedText = EdgeTTS.escapeXml(text);
        const ssml =
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
          `<voice name='${voiceId}'>` +
          `<prosody pitch='+0Hz' rate='${rateStr}' volume='+0%'>` +
          `${escapedText}` +
          `</prosody></voice></speak>`;

        const ssmlMsg =
          `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml;

        ws.send(ssmlMsg);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          if (event.data.includes('Path:turn.end')) {
            isCompleted = true;
            clearTimeout(timeoutId);
            try { ws.close(); } catch {}

            if (audioChunks.length === 0) {
              reject(new Error('No audio data received.'));
            } else {
              const fullBlob = new Blob(audioChunks, { type: 'audio/mpeg' });
              resolve(fullBlob);
            }
          }
        } else if (event.data instanceof ArrayBuffer) {
          // Binary message: 2-byte header length, followed by header, followed by audio data
          const buffer = event.data;
          const view = new DataView(buffer);
          if (buffer.byteLength > 2) {
            const headerLength = view.getUint16(0);
            const audioOffset = 2 + headerLength;
            if (audioOffset < buffer.byteLength) {
              const audioPart = new Uint8Array(buffer, audioOffset);
              audioChunks.push(audioPart);
            }
          }
        }
      };

      ws.onerror = (err) => {
        if (!isCompleted) {
          isCompleted = true;
          clearTimeout(timeoutId);
          reject(new Error(`WebSocket error during synthesis: ${err}`));
        }
      };

      ws.onclose = () => {
        if (!isCompleted) {
          isCompleted = true;
          clearTimeout(timeoutId);
          if (audioChunks.length > 0) {
            resolve(new Blob(audioChunks, { type: 'audio/mpeg' }));
          } else {
            reject(new Error('WebSocket closed before audio reception completed.'));
          }
        }
      };
    });
  }

  /**
   * Speaks text using neural voice with completion callback and instant interruption.
   */
  public async speak(
    text: string,
    options: {
      rate?: number;
      voiceId?: string;
      onStart?: () => void;
      onEnd?: () => void;
    } = {}
  ): Promise<void> {
    this.stop();

    const voice = options.voiceId || this.selectedVoiceId;
    const rate = options.rate ?? 1.0;

    const audioBlob = await this.synthesize(text, voice, rate);

    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
    }

    const blobUrl = URL.createObjectURL(audioBlob);
    this.currentBlobUrl = blobUrl;

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(blobUrl);
      this.currentAudio = audio;
      this.isPlaying = true;

      audio.onplay = () => {
        if (options.onStart) options.onStart();
      };

      audio.onended = () => {
        this.isPlaying = false;
        if (options.onEnd) options.onEnd();
        resolve();
      };

      audio.onerror = (e) => {
        this.isPlaying = false;
        reject(new Error(`Audio playback error: ${e}`));
      };

      audio.play().catch((playErr) => {
        this.isPlaying = false;
        reject(playErr);
      });
    });
  }

  /**
   * Instantly stops any ongoing playback and cancels in-flight requests.
   */
  public stop(): void {
    if (this.activeWs) {
      try {
        this.activeWs.close();
      } catch {}
      this.activeWs = null;
    }

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }

    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl);
      } catch {}
      this.currentBlobUrl = null;
    }

    this.isPlaying = false;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
