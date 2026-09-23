/**
 * tests/decision-engine.test.ts
 * Automated unit test suite verifying DecisionEngine intent dispatching and conversational summaries.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DecisionEngine } from '../src/decision-engine.ts';
import type { ActionableElement } from '../src/types/index.ts';

describe('DecisionEngine', () => {
  const mockElements: ActionableElement[] = [
    { id: 1, role: 'searchbox', name: 'Search products' },
    { id: 2, role: 'button', name: 'Cart (0 items)' },
    { id: 3, role: 'button', name: 'Sign In' },
    { id: 4, role: 'link', name: 'Help & Customer Service' },
  ];

  const mockContext = {
    siteName: 'Example Store',
    pageTitle: 'Example Store: Online Shopping',
    elements: mockElements,
  };

  it('generates a warm conversational summary prioritizing search and cart', () => {
    const summary = DecisionEngine.generatePageSummary(mockContext);
    assert.match(summary, /You are on Example Store/i);
    assert.match(summary, /search for a product/i);
    assert.match(summary, /cart/i);
  });

  it('maps "Search for vintage jackets" to fill_and_submit on searchbox (ID 1)', () => {
    const decision = DecisionEngine.parseIntent('Search for vintage jackets', mockElements, mockContext);
    
    assert.equal(decision.intent, 'SEARCH');
    assert.equal(decision.action.type, 'fill_and_submit');
    assert.equal(decision.action.id, 1);
    assert.equal(decision.action.value, 'vintage jackets');
    assert.match(decision.spokenResponse, /vintage jackets/i);
  });

  it('maps "Click cart" to click on button (ID 2)', () => {
    const decision = DecisionEngine.parseIntent('Click cart', mockElements, mockContext);

    assert.equal(decision.intent, 'CLICK');
    assert.equal(decision.action.type, 'click');
    assert.equal(decision.action.id, 2);
    assert.match(decision.spokenResponse, /Cart/i);
  });

  it('maps direct number command "Click 3" to element ID 3', () => {
    const decision = DecisionEngine.parseIntent('Click 3', mockElements, mockContext);

    assert.equal(decision.intent, 'CLICK_BY_ID');
    assert.equal(decision.action.type, 'click');
    assert.equal(decision.action.id, 3);
  });

  it('maps "scroll down" to scroll action with down direction', () => {
    const decision = DecisionEngine.parseIntent('scroll down', mockElements, mockContext);

    assert.equal(decision.intent, 'SCROLL');
    assert.equal(decision.action.type, 'scroll');
    assert.equal(decision.action.direction, 'down');
  });

  it('maps "stop" to CANCEL intent with empty spokenResponse', () => {
    const decision = DecisionEngine.parseIntent('stop', mockElements, mockContext);

    assert.equal(decision.intent, 'CANCEL');
    assert.equal(decision.action.type, 'none');
    assert.equal(decision.spokenResponse, '');
  });

  it('maps "what can I do?" to SUMMARY intent with full conversational summary', () => {
    const decision = DecisionEngine.parseIntent('what can I do?', mockElements, mockContext);

    assert.equal(decision.intent, 'SUMMARY');
    assert.match(decision.spokenResponse, /You are on Example Store/i);
  });
});
