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

  it('splits chained utterance on "then", "and then", and "after that"', () => {
    const text = 'click cart and then scroll down after that click sign in';
    const commands = DecisionEngine.splitUtteranceIntoCommands(text, mockElements, mockContext);
    assert.deepEqual(commands, ['click cart', 'scroll down', 'click sign in']);
  });

  it('splits on "and" only when both sides parse as valid actions', () => {
    const chained = 'click cart and scroll down';
    const commands1 = DecisionEngine.splitUtteranceIntoCommands(chained, mockElements, mockContext);
    assert.deepEqual(commands1, ['click cart', 'scroll down']);

    // "search for apples and oranges" should not split because "oranges" alone is not a command
    const single = 'search for apples and oranges';
    const commands2 = DecisionEngine.splitUtteranceIntoCommands(single, mockElements, mockContext);
    assert.deepEqual(commands2, ['search for apples and oranges']);
  });

  it('matches synonyms like "bag" to Cart button', () => {
    const decision = DecisionEngine.parseIntent('click bag', mockElements, mockContext);
    assert.equal(decision.intent, 'CLICK');
    assert.equal(decision.action.id, 2);
  });

  it('matches synonyms like "log in" to Sign In button', () => {
    const decision = DecisionEngine.parseIntent('click log in', mockElements, mockContext);
    assert.equal(decision.intent, 'CLICK');
    assert.equal(decision.action.id, 3);
  });

  it('triggers DISAMBIGUATE when two candidates score very close', () => {
    const elements: ActionableElement[] = [
      { id: 10, role: 'button', name: 'Submit order now' },
      { id: 11, role: 'button', name: 'Submit order later' },
    ];
    const decision = DecisionEngine.parseIntent('click submit order', elements, mockContext);
    assert.equal(decision.intent, 'DISAMBIGUATE');
    assert.match(decision.spokenResponse, /Did you mean #10/i);
    assert.match(decision.spokenResponse, /or #11/i);
  });

  it('builds a rich heuristic "Where am I?" summary', () => {
    const richContext = {
      siteName: 'Example Store',
      pageTitle: 'Example Store: Online Shopping',
      elements: mockElements,
      details: {
        landmarks: ['main', 'navigation', 'search'],
        headings: ['Welcome to Example Store', 'Featured Products'],
        counts: { links: 24, buttons: 6, inputs: 2 },
        mainContentSnippet: 'Discover our wide selection of goods. Free shipping on all orders over fifty dollars.',
      },
    };

    const summary = DecisionEngine.buildWhereAmISummary(richContext);
    assert.match(summary, /You are on Example Store/i);
    assert.match(summary, /Landmarks include main, navigation, search/i);
    assert.match(summary, /Key headings: "Welcome to Example Store", "Featured Products"/i);
    assert.match(summary, /24 links, 6 buttons, 2 input fields/i);
    assert.match(summary, /Discover our wide selection/i);

    const intentResult = DecisionEngine.parseIntent('where am I', mockElements, richContext);
    assert.equal(intentResult.intent, 'SUMMARY');
    assert.match(intentResult.spokenResponse, /Landmarks include/i);
  });

  it('maps "next heading" and "previous heading" correctly', () => {
    const nextH = DecisionEngine.parseIntent('next heading', mockElements, mockContext);
    assert.equal(nextH.action.type, 'navigate_heading');
    assert.equal(nextH.action.navDirection, 'next');

    const prevH = DecisionEngine.parseIntent('previous heading', mockElements, mockContext);
    assert.equal(prevH.action.type, 'navigate_heading');
    assert.equal(prevH.action.navDirection, 'previous');
  });

  it('maps "next link" and landmark navigation commands', () => {
    const nextL = DecisionEngine.parseIntent('next link', mockElements, mockContext);
    assert.equal(nextL.action.type, 'navigate_link');
    assert.equal(nextL.action.navDirection, 'next');

    const goToMain = DecisionEngine.parseIntent('go to main', mockElements, mockContext);
    assert.equal(goToMain.action.type, 'navigate_landmark');
    assert.equal(goToMain.action.landmarkType, 'main');

    const goToNav = DecisionEngine.parseIntent('go to navigation', mockElements, mockContext);
    assert.equal(goToNav.action.type, 'navigate_landmark');
    assert.equal(goToNav.action.landmarkType, 'navigation');

    const listLm = DecisionEngine.parseIntent('list landmarks', mockElements, {
      ...mockContext,
      details: { landmarks: ['main', 'navigation'], headings: [], counts: { links: 0, buttons: 0, inputs: 0 } },
    });
    assert.equal(listLm.intent, 'SUMMARY');
    assert.match(listLm.spokenResponse, /Landmarks on this page: main, navigation/i);
  });

  it('triggers CONFIRM intent for risky actions like delete and purchase', () => {
    const riskyElements: ActionableElement[] = [
      { id: 20, role: 'button', name: 'Delete Account' },
      { id: 21, role: 'button', name: 'Place Order' },
      { id: 22, role: 'button', name: 'Confirm Purchase' },
      { id: 23, role: 'button', name: 'Submit Form', isSubmit: true },
    ];

    const delDecision = DecisionEngine.parseIntent('click delete account', riskyElements, mockContext);
    assert.equal(delDecision.intent, 'CONFIRM');
    assert.equal(delDecision.requiresConfirmation, true);
    assert.match(delDecision.spokenResponse, /Are you sure you want to Delete Account\?/i);

    const orderDecision = DecisionEngine.parseIntent('click 21', riskyElements, mockContext);
    assert.equal(orderDecision.intent, 'CONFIRM');
    assert.equal(orderDecision.requiresConfirmation, true);
    assert.match(orderDecision.spokenResponse, /Are you sure you want to Place Order\?/i);

    const submitDecision = DecisionEngine.parseIntent('click 23', riskyElements, mockContext);
    assert.equal(submitDecision.intent, 'CONFIRM');
    assert.equal(submitDecision.requiresConfirmation, true);
  });

  it('parses voice macro commands correctly', () => {
    const startRec = DecisionEngine.parseIntent('remember this as checkout flow', mockElements, mockContext);
    assert.equal(startRec.intent, 'MACRO');
    assert.equal(startRec.macroAction, 'record_start');
    assert.equal(startRec.macroName, 'checkout flow');

    const stopRec = DecisionEngine.parseIntent('stop remembering', mockElements, mockContext);
    assert.equal(stopRec.intent, 'MACRO');
    assert.equal(stopRec.macroAction, 'record_stop');

    const runMacro = DecisionEngine.parseIntent('run checkout flow', mockElements, mockContext);
    assert.equal(runMacro.intent, 'MACRO');
    assert.equal(runMacro.macroAction, 'run');
    assert.equal(runMacro.macroName, 'checkout flow');

    const listMacro = DecisionEngine.parseIntent('list macros', mockElements, mockContext);
    assert.equal(listMacro.intent, 'MACRO');
    assert.equal(listMacro.macroAction, 'list');

    const deleteMacro = DecisionEngine.parseIntent('delete macro checkout flow', mockElements, mockContext);
    assert.equal(deleteMacro.intent, 'MACRO');
    assert.equal(deleteMacro.macroAction, 'delete');
    assert.equal(deleteMacro.macroName, 'checkout flow');
  });
});
