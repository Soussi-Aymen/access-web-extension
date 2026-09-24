/**
 * tests/voice-engine.test.ts
 * Automated unit test suite verifying VoiceEngine voice prioritization and sentence chunking.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { VoiceEngine } from '../src/voice-engine.ts';

describe('VoiceEngine', () => {
  it('correctly splits long passages into conversational sentences', () => {
    const engine = new VoiceEngine();
    const text = "You are on Example Store. Would you like to search for a product or view your cart? Say stop to cancel.";
    const sentences = engine.splitIntoSentences(text);

    assert.equal(sentences.length, 3);
    assert.equal(sentences[0], "You are on Example Store.");
    assert.equal(sentences[1], "Would you like to search for a product or view your cart?");
    assert.equal(sentences[2], "Say stop to cancel.");
  });

  it('prioritizes Microsoft Natural voices over Google and standard voices (Tier 1)', () => {
    const engine = new VoiceEngine();
    const mockVoices = [
      { name: 'Google US English', lang: 'en-US', default: false, localService: false, voiceURI: 'google-us' } as SpeechSynthesisVoice,
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', default: false, localService: false, voiceURI: 'ms-natural' } as SpeechSynthesisVoice,
      { name: 'Alex', lang: 'en-US', default: true, localService: true, voiceURI: 'alex' } as SpeechSynthesisVoice,
    ];

    const best = engine.pickBestVoice(mockVoices);
    assert.ok(best);
    assert.equal(best.name, 'Microsoft Aria Online (Natural) - English (United States)');
  });

  it('prioritizes Google US English voices when Natural is absent (Tier 2)', () => {
    const engine = new VoiceEngine();
    const mockVoices = [
      { name: 'Samantha (Enhanced)', lang: 'en-US', default: false, localService: true, voiceURI: 'samantha-enhanced' } as SpeechSynthesisVoice,
      { name: 'Google US English', lang: 'en-US', default: false, localService: false, voiceURI: 'google-us' } as SpeechSynthesisVoice,
      { name: 'English United Kingdom', lang: 'en-GB', default: false, localService: true, voiceURI: 'en-gb' } as SpeechSynthesisVoice,
    ];

    const best = engine.pickBestVoice(mockVoices);
    assert.ok(best);
    assert.equal(best.name, 'Google US English');
  });

  it('defaults to 0.95 rate and 1.0 pitch calibration', () => {
    const engine = new VoiceEngine();
    assert.equal(engine.rate, 0.95);
    assert.equal(engine.pitch, 1.0);
  });

  it('generates a valid 64-character uppercase SHA-256 Sec-MS-GEC DRM token', async () => {
    const { EdgeTTS } = await import('../src/edge-tts.ts');
    const token = await EdgeTTS.generateSecMsGec();
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9A-F]{64}$/);
  });

  it('defaults to native speechSynthesis voice and allows toggling to neural', async () => {
    const engine = new VoiceEngine();
    assert.equal(engine.useNeuralVoice, false);
    assert.equal(engine.selectedVoiceId, 'system');
    assert.equal(engine.getActiveVoiceLabel(), 'System Default');

    // Toggle to neural voice
    engine.useNeuralVoice = true;
    const changed = engine.setNeuralVoice('en-US-GuyNeural');
    assert.equal(changed, true);
    assert.equal(engine.edgeTTS.selectedVoiceId, 'en-US-GuyNeural');

    const label = engine.getActiveVoiceLabel();
    assert.equal(label, 'Guy (Natural Neural)');
  });

  it('correctly chunks long text under 175 characters for GoogleTTS', async () => {
    const { GoogleTTS } = await import('../src/google-tts.ts');
    const longText = 'Welcome to a11y-pilot, an advanced conversational accessibility pilot for the web. It inspects page hierarchies and helps users navigate efficiently by voice, clicking buttons, typing search terms, and scrolling pages without robotic synthetic audio.';
    const chunks = GoogleTTS.chunkText(longText, 175);

    assert.ok(chunks.length >= 2);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 175, `Chunk exceeded 175 chars: ${chunk}`);
    }
  });

  it('supports selecting Google Natural neural voice when enabled', () => {
    const engine = new VoiceEngine();
    engine.useNeuralVoice = true;
    engine.setNeuralVoice('google-en-US');
    assert.equal(engine.selectedVoiceId, 'google-en-US');
    assert.equal(engine.getActiveVoiceLabel(), 'Google Natural (US Neural)');

    const changed = engine.setNeuralVoice('google-en-GB');
    assert.equal(changed, true);
    assert.equal(engine.selectedVoiceId, 'google-en-GB');
    assert.equal(engine.googleTTS.selectedLocale, 'en-GB');
    assert.equal(engine.getActiveVoiceLabel(), 'Google Natural (British Neural)');
  });
});

