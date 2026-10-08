// Offline admin interactions: no model requests or production learner records.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const flush = () => new Promise(resolve => setImmediate(resolve));
const item = {
  id:'teaching:' + 'a'.repeat(64), reason:'revision_conflict', status:'pending', createdAt:Date.now(),
  focusKey:'user_reason', previousScript:'我是小满。请帮我复活。', script:'我是小满。你想听哪种开头？',
  previousCoaching:{original:'请帮我复活。',example:'你想听哪种开头？',action:'给一个可参与的内容。',why:'先让观众有选择。',related_edits:[{original:'其他求情句',example:''}]},
  currentReport:{verdict:'almost',card_why:'尚无参与理由',verdict_reason:'只问了兴趣',revision_note:'上次问题仍未解决'},
  detail:'建议采纳后原问题仍被判未解决。', correction:null,
};
function harness() {
  const elements = new Map(), requests = [], notices = [];
  const all = node => [node, ...node.children.flatMap(all)];
  function node(tag = 'div') {
    let text = '';
    const el = {tag, children:[], events:{}, dataset:{}, attributes:{}, className:'', value:'', hidden:false, disabled:false,
      get firstChild() { return this.children[0] || null; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, fn) { this.events[key] = fn; },
      querySelectorAll(selector) { return all(this).slice(1).filter(child => selector[0] === '.' ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      click() { if (!this.disabled) this.events.click?.(); },
    };
    el.classList = {toggle(name, value) { const set = new Set(el.className.split(' ').filter(Boolean)); if (value) set.add(name); else set.delete(name); el.className = [...set].join(' '); }};
    Object.defineProperty(el, 'textContent', {get() { return text + this.children.map(child => child.textContent).join(''); }, set(value) { text = String(value); this.children = []; }});
    Object.defineProperty(el, 'innerHTML', {set() { throw Error('Untrusted data cannot be inserted as HTML'); }});
    return el;
  }
  const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const c = vm.createContext({console, Promise, setTimeout:() => 1, setInterval:() => 1,
    document:{getElementById:get,createElement:node,addEventListener(){}}, confirm:() => true});
  c.window = c; c.self = c; c.top = c;
  vm.runInContext(readFileSync(new URL('../site/js/coach.js', import.meta.url), 'utf8'), c);
  c.Coach._toast = message => notices.push(message);
  c.Coach._request = (path, options) => new Promise((resolve, reject) => requests.push({path, options, resolve, reject}));
  c.Coach._tab = 'teaching';
  const render = value => { c.Coach._renderList([structuredClone(value)], true, false); return get('list-container').firstChild; };
  const field = (card, name) => all(card).find(child => child.name === name);
  const fill = (card, name, value) => { const input = field(card, name); input.value = value; input.events[name === 'judgment' ? 'change' : 'input'](); };
  const find = (card, name) => card.querySelector('.teaching-review__' + name);
  return {c, get, requests, notices, render, field, fill, find, all};
}

const h = harness(), card = h.render(item), save = h.find(card, 'save');
assert.ok(card.textContent.includes(item.previousScript));
assert.ok(card.textContent.includes(item.script));
assert.ok(card.textContent.includes(item.previousCoaching.example));
assert.match(card.textContent, /删除这一处/);
assert.match(card.textContent, /不会直接改判/);
assert.equal(save.disabled, true);
h.fill(card, 'judgment', 'false_rejection'); h.fill(card, 'reason', '这次已经按上一轮示范完成。');
assert.equal(save.disabled, true, 'a corrected decision requires an actionable example');
h.fill(card, 'example', '你想听哪种开头？'); h.fill(card, 'keep', '保留名字和自愿选择。');
assert.equal(save.disabled, false);
save.click(); save.events.click(); await flush();
assert.equal(h.requests.length, 1, 'duplicate save events cannot create a second write');
assert.match(h.requests[0].path, /teaching%3A[a-f0-9]+\/resolve$/);
assert.equal(h.requests[0].options.method, 'POST');
assert.deepEqual(JSON.parse(h.requests[0].options.body), {judgment:'false_rejection',reason:'这次已经按上一轮示范完成。',example:'你想听哪种开头？',keep:'保留名字和自愿选择。'});
assert.equal(h.field(card, 'reason').disabled, true);
assert.equal(h.find(card, 'delete').disabled, true);
h.requests[0].reject(Error('服务暂时不可用')); await flush();
assert.match(h.find(card, 'feedback').textContent, /填写内容仍保留/);
assert.equal(h.field(card, 'reason').value, '这次已经按上一轮示范完成。');
assert.equal(save.disabled, false);
save.click(); await flush(); h.requests[1].resolve({ok:true,item:{...item,status:'reviewed',correction:JSON.parse(h.requests[1].options.body)}}); await flush();
assert.match(card.textContent, /老师已核对/);
assert.match(h.find(card, 'feedback').textContent, /已保存，尚未加入参考案例/);
assert.equal(h.c.Coach._teachingDrafts[item.id], undefined);
assert.equal(h.requests.some(request => /\/api\/admin\/cases/.test(request.path)), false, 'saving a correction never publishes it as a reference case');

for (const judgment of ['false_acceptance', 'invalid_advice']) {
  h.fill(card, 'judgment', judgment); h.fill(card, 'example', '');
  assert.equal(save.disabled, true);
  h.fill(card, 'example', '写清能兑现的内容再邀请参与。'); assert.equal(save.disabled, false);
}
h.fill(card, 'judgment', 'correct'); h.fill(card, 'example', ''); assert.equal(save.disabled, false);
h.fill(card, 'reason', '字'.repeat(601)); assert.equal(save.disabled, true);
h.fill(card, 'reason', '仍需补具体内容。');
const rerendered = h.render(item);
assert.equal(h.field(rerendered, 'reason').value, '仍需补具体内容。', 'switching list views does not erase an unsaved teacher draft');

// A stale list response cannot overwrite a newly selected tab.
const race = harness();
race.c.Coach.loadList();
assert.equal(race.requests[0].path, '/api/admin/teaching-reviews?limit=30');
race.c.Coach._switchTab('manual');
race.requests[0].resolve({ok:true,items:[item],hasMore:false}); await flush();
assert.equal(race.get('list-container').querySelector('.teaching-review'), null);
race.requests[1].resolve({ok:true,items:[],hasMore:false}); await flush();
race.c.Coach._switchTab('teaching');
race.requests[2].resolve({ok:true,items:[],hasMore:true,nextCursor:'opaque+/='}); await flush();
assert.equal(race.get('btn-load-more').hidden, false);
race.c.Coach.loadMore(); assert.match(race.requests[3].path, /cursor=opaque%2B%2F%3D$/);
race.requests[3].resolve({ok:true,items:[item],hasMore:false}); await flush();
assert.equal(race.get('list-container').querySelectorAll('.case-card').length, 1);
assert.equal(race.get('btn-load-more').hidden, true);

// Failed load surfaces the server's useful configuration error and a retry action.
const unavailable = harness(); unavailable.c.Coach.loadList();
unavailable.requests[0].reject(Error('教学纠错存储未配置')); await flush();
assert.match(unavailable.get('list-container').textContent, /存储未配置/);
assert.match(unavailable.get('list-container').textContent, /重新加载/);

// Delete is explicit, locked, recoverable on failure and removes only the selected record.
const del = harness(), dcard = del.render(item), remove = del.find(dcard, 'delete');
del.c.confirm = () => false; remove.click(); await flush(); assert.equal(del.requests.length, 0);
del.c.confirm = () => true; remove.click(); remove.events.click(); await flush(); assert.equal(del.requests.length, 1);
assert.equal(del.requests[0].options.method, 'DELETE');
del.requests[0].reject(Error('稍后再试')); await flush();
assert.ok(del.get('list-container').querySelector('.teaching-review'));
assert.equal(remove.disabled, false);
remove.click(); await flush(); del.requests[1].resolve({ok:true}); await flush();
assert.equal(del.get('list-container').querySelector('.teaching-review'), null);

// All original/model/teacher text stays inert in rendered evidence and restored inputs.
const hostile = harness();
const xcard = hostile.render({...item,script:'<img src=x onerror=evil()>',detail:'<script>evil()</script>',correction:{judgment:'correct',reason:'<svg/onload=evil()>',example:'',keep:''}});
assert.ok(xcard.textContent.includes('<img src=x onerror=evil()>'));
assert.ok(xcard.textContent.includes('<script>evil()</script>'));
assert.equal(hostile.field(xcard, 'reason').value, '<svg/onload=evil()>');
assert.equal(hostile.all(xcard).some(el => ['img','script','svg'].includes(el.tag)), false);
console.log('PASS teaching review UI: evidence, required corrections, inert text, write locks, errors, draft retention, pagination, stale tabs and explicit deletion');
