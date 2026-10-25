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
console.log('Focus checks passed: initiator, retry fallback, unavailable contexts and newer user focus');

// Fleet buttons must distinguish equal container names on different hosts.
const rowsElement={children:[],replaceChildren(...children){this.children=children;}};
function renderedNode(tag,className='',text='') {
  return {tag,className,textContent:String(text),dataset:{},children:[],attributes:{},
    append(...children){this.children.push(...children);},
    setAttribute(name,value){this.attributes[name]=String(value);}};
}
const opened=[];
const rowContext=vm.createContext({
  document:{activeElement:null},node:renderedNode,$:()=>rowsElement,
  groupByProject:false,selected:null,lastError:'',needsAttention:()=>false,
  duration:()=>'',openContainerDetails:(hostId,id)=>opened.push([hostId,id]),
});
const rowStart=source.indexOf('function renderRows('),rowEnd=source.indexOf('function render()',rowStart);
assert.ok(rowStart>=0 && rowEnd>rowStart);
vm.runInContext(source.slice(rowStart,rowEnd),rowContext);
const fleetContainers=[
  {hostId:'host-one',hostName:'Fixture <one>',id:'a'.repeat(64)},
  {hostId:'host-two',hostName:'Fixture "two"',id:'b'.repeat(64)},
].map(container=>({...container,name:'web <app>',image:'fixture',state:'running',health:'none',restarts:0,startedAt:''}));
rowContext.renderRows(fleetContainers);
const containerButtons=rowsElement.children.map(row=>row.children[0].children[0]);
const accessibleNames=containerButtons.map(button=>button.attributes['aria-label']||button.textContent);
assert.equal(new Set(accessibleNames).size,2,'Equal container names must retain distinct host context');
for(let i=0;i<containerButtons.length;i++) {
  assert.equal(containerButtons[i].textContent,fleetContainers[i].name);
  assert.ok(accessibleNames[i].startsWith(containerButtons[i].textContent),'Accessible names start with the visible container name');
  assert.ok(accessibleNames[i].includes(fleetContainers[i].hostName),'Accessible names include the literal host name');
}
containerButtons[1].onclick();
assert.deepEqual(opened,[[fleetContainers[1].hostId,fleetContainers[1].id]]);
console.log('Container control checks passed: distinct host context, visible label prefix, unchanged labels and correct target');