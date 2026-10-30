import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('worker/board.js', 'utf8');
const start = source.indexOf('function restoreFocus(');
const end = source.indexOf('function setupStage(', start);
assert.ok(start >= 0 && end > start);
const body = {contains: element => element.connected};
const document = {body, activeElement: body};
const context = vm.createContext({document});
vm.runInContext(source.slice(start, end), context);

function control(id, options = {}) {
  return {
    id, connected: true, disabled: false, hidden: false, inert: false,
    ...options,
    closest() { return this.hidden || this.inert ? this : null; },
    getClientRects() { return this.visible === false || this.hidden ? [] : [{}]; },
    focus() { if (!this.disabled && !this.hidden && !this.inert && this.connected) document.activeElement = this; },
  };
}
function restore(original, fallback) {
  document.activeElement = body;
  context.restoreFocus(original, fallback);
  return document.activeElement;
}

const initiator = control('retry');
const contextHeading = control('context-heading');
assert.equal(restore(initiator, contextHeading), initiator);
for (const options of [{hidden: true}, {inert: true}, {disabled: true}, {connected: false}, {visible: false}]) {
  assert.equal(restore(control('unavailable', options), contextHeading), contextHeading);
}
assert.equal(restore(control('removed', {connected: false})), body);
assert.equal(restore(control('hidden-retry', {hidden: true}), control('hidden-context', {hidden: true})), body);
const moved = control('user-selected-control');
document.activeElement = moved;
context.restoreFocus(initiator, contextHeading);
assert.equal(document.activeElement, moved, 'An async response must preserve the user\'s newer focus');
assert.equal(restore(null, contextHeading), contextHeading);

assert.ok(source.includes("restoreFocus(focused, $('fleet-view'))"), 'loadHosts must restore focus with fleet-view as the fallback element');
assert.ok(source.includes("else $('containers').focus({preventScroll:true})"), 'alert button click handler must focus containers section when no containerId exists');

console.log('Focus checks passed: initiator, retry fallback, unavailable contexts and newer user focus');
