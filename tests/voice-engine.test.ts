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
});
