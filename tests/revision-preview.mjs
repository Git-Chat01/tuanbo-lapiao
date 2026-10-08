// Offline interaction regression for optional, reversible coach-edit previews.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const original = '我是小满。\n求求你救我。\n大家不帮我就没办法了。\n愿意的话帮我点一下复活。';
const example = '你想听轻快的还是安静的？我把两种开头各唱一句，你来选。';
const lesson = {
  focus_key:'user_reason', keep:'名字和自愿的请求都保留。', original:'求求你救我。',
  action:'换成观众能参与的内容，删掉后面同样求情的一句。', example,
  why:'原来只说自己需要什么，现在说明了观众可以怎样参与。',
  related_edits:[{original:'大家不帮我就没办法了。', example:''}],
};
const expected = '我是小满。\n' + example + '\n\n愿意的话帮我点一下复活。';

function session(storage = new Map()) {
  const elements = new Map(), toasts = [], submits = [];
  function node(tag) {
    const el = {tag, children:[], events:{}, attributes:{}, style:{}, dataset:{}, value:'',
      hidden:false, disabled:false, selectionStart:0, selectionEnd:0,
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      insertBefore(child, before) { const at = this.children.indexOf(before); assert.notEqual(at, -1); this.children.splice(at, 0, child); child.parentNode = this; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, fn) { this.events[key] = fn; },
      focus() { this.focused = true; },
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      click() { if (!this.disabled) this.events.click?.(); },
    };
    let content = '';
    Object.defineProperty(el, 'textContent', {
      get() { return content + this.children.map(child => child.textContent).join(''); },
      set(value) { content = String(value); this.children = []; },
    });
    Object.defineProperty(el, 'innerHTML', {set() { throw Error('Model content must never render as HTML'); }});
    Object.defineProperty(el, 'id', {get() { return this._id; }, set(value) { this._id = value; elements.set(value, this); }});
    return el;
  }
  const context = vm.createContext({console, LIMITS:{scriptMin:1, scriptMax:500},
    localStorage:{getItem:key => storage.get(key) || null, setItem:(key,value) => storage.set(key,value)},
    document:{createElement:node},
    App:{state:{lastRequest:{mode:'free', voteGap:'far', script:original}, lastReport:{coaching:structuredClone(lesson)}}, toast:text => toasts.push(text)},
    Form:{submitRevision:text => submits.push(text)},
  });
  context.window = context;
  vm.runInContext(readFileSync(new URL('../site/js/report.js', import.meta.url), 'utf8'), context);
  const R = context.Report;
  const render = () => R._revisionDesk({key:'user_reason', evidence:lesson.original}, {focusAttempts:2});
  const all = el => [el, ...el.children.flatMap(all)];
  const find = (el, className) => all(el).find(item => (item.className || '').split(' ').includes(className));
  const input = text => { const el = elements.get('revision-script'); el.value = text; el.events.input(); return el; };
  return {context, R, render, find, all, input, elements, storage, toasts, submits};
}

const s = session(), {R} = s;
const preview = R._coachingPreview(original, lesson);
assert.equal(preview.script, expected);
assert.equal(preview.parts.filter(part => part.kind === 'remove').length, 2, 'deletions remain visible in the comparison');
assert.equal(preview.parts.filter(part => part.kind !== 'remove').map(part => part.text).join(''), expected);
assert.equal(R._coachingPreview(original, {...lesson, related_edits:undefined}).script, original.replace(lesson.original, lesson.example));
assert.equal(R._coachingPreview('相同句。相同句。', {...lesson, original:'相同句。', related_edits:undefined}), null, 'ambiguous primary quote has no apply action');
assert.equal(R._coachingPreview(original, {...lesson, related_edits:[{original:'求求你', example:'请你'}]}), null, 'overlapping quotes must not partially apply');
assert.equal(R._coachingPreview(original, {...lesson, related_edits:[{original:'找不到的原句', example:'替换'}]}), null);
assert.equal(R._coachingPreview(original, {...lesson, related_edits:Array(5).fill({original:'我是小满。',example:'你好'})}), null);
assert.equal(R._coachingPreview(original, {...lesson, example:'啊'.repeat(161)}), null);
assert.equal(R._coachingPreview('甲'.repeat(499) + '乙', {...lesson, original:'乙', example:'丙丁', related_edits:[]}), null, 'expanded preview cannot exceed editor limit');
assert.equal(R._coachingPreview('乙', {...lesson, original:'乙', example:'', related_edits:[]}), null, 'empty merged drafts cannot be adopted');
assert.equal(R._coachingPreview('乙', {...lesson, original:'乙', example:'乙', related_edits:[]}), null);
const reordered = {...lesson, original:lesson.related_edits[0].original, example:'', related_edits:[{original:lesson.original,example:lesson.example}]};
assert.equal(R._coachingPreview(original, reordered).script, expected, 'edit order is based on source positions');
const chained = R._coachingPreview('甲。乙。', {...lesson, original:'甲。',example:'乙。',related_edits:[{original:'乙。',example:'丙。'}]});
assert.equal(chained.script, '乙。丙。', 'inserted examples cannot become a later replacement target');

let desk = s.render(), editor = s.elements.get('revision-script');
const control = key => s.find(desk, 'revision-preview__' + key);
assert.equal(editor.value, original, 'rendering a preview never changes the draft');
assert.equal(s.submits.length, 0);
assert.match(control('note').textContent, /不代表整稿已经通过/);
assert.equal(control('undo').hidden, true);
assert.equal(control('apply').textContent, '采用到改稿框');
assert.equal(s.find(desk, 'revision-submit').disabled, true);

// An existing learner edit is explicitly replaced, and its exact text/selection can be restored.
const before = '大家好！' + original;
s.input(before); editor.setSelectionRange(2, 5);
assert.match(control('apply').textContent, /替换当前改稿/);
assert.match(control('state').textContent, /当前内容会保留/);
control('apply').click();
assert.equal(editor.value, expected);
assert.equal(editor.value.slice(editor.selectionStart,editor.selectionEnd), example);
assert.equal(s.submits.length, 0, 'adoption is never a submission');
assert.equal(s.find(desk, 'revision-count').textContent, expected.length + ' / 500');
assert.equal(s.find(desk, 'revision-submit').disabled, false);
assert.equal(JSON.parse(s.storage.get(R._workspaceKey)).revision, expected);
assert.equal(control('apply').hidden, true);
assert.equal(control('undo').hidden, false);

const after = expected + '谢谢你。';
s.input(after); editor.setSelectionRange(after.length, after.length);
control('undo').click();
assert.equal(editor.value, before, 'undo restores all pre-adoption learner edits');
assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 5);
assert.equal(JSON.parse(s.storage.get(R._workspaceKey)).previewUndo.after, after, 'post-adoption edits survive undo');
assert.equal(s.find(desk, 'revision-count').textContent, before.length + ' / 500');
assert.equal(control('undo').textContent, '切回采用后的稿子');
const revisedBefore = before + '我再想想。';
s.input(revisedBefore);
control('undo').click();
assert.equal(editor.value, after, 'switching back restores edited adopted version');
assert.equal(editor.selectionStart, after.length);
assert.equal(JSON.parse(s.storage.get(R._workspaceKey)).previewUndo.before, revisedBefore);

// Saved undo branches survive recreating the view and a fresh JS session.
const saved = JSON.parse(s.storage.get(R._workspaceKey));
const fresh = session(s.storage);
fresh.R._workspace = saved;
const freshDesk = fresh.render();
assert.equal(fresh.elements.get('revision-script').value, after);
fresh.find(freshDesk, 'revision-preview__undo').click();
assert.equal(fresh.elements.get('revision-script').value, revisedBefore);
fresh.find(freshDesk, 'revision-preview__undo').click();
assert.equal(fresh.elements.get('revision-script').value, after);

const locate = s.find(desk, 'revision-locate');
locate.click();
assert.match(s.toasts.at(-1), /已经改过/, 'old quote buttons do not select the wrong sentence after adoption');
control('undo').click(); locate.click();
assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), lesson.original);
s.find(desk, 'revision-submit').click();
assert.deepEqual(s.submits, [revisedBefore], 'only the explicit submit action sends current text');

// Storage failures remain visible for generated edits as well as typing.
s.context.localStorage.setItem = () => { throw Error('quota'); };
control('undo').click();
assert.match(s.find(desk, 'revision-state').textContent, /本机无法保存/);

// Hostile model text is displayed literally, in both insertions and deletions.
const x = session();
x.context.App.state.lastRequest.script = '<img src=x onerror=evil()>原话';
x.context.App.state.lastReport.coaching = {...lesson, original:'<img src=x onerror=evil()>原话', example:'<script>evil()</script>修改', related_edits:[]};
const xdesk = x.render(), copy = x.find(xdesk, 'revision-preview__script');
assert.ok(copy.textContent.includes('<script>evil()</script>'));
assert.equal(x.all(copy).filter(item => item.tag === 'img' || item.tag === 'script').length, 0);
assert.equal(x.all(copy).filter(item => item.tag === 'del').length, 1);
assert.equal(x.all(copy).filter(item => item.tag === 'ins').length, 1);

// Invalid suggestions suppress just the preview, leaving manual revision usable.
const bad = session();
bad.context.App.state.lastRequest.script = '求求你救我。求求你救我。';
bad.context.App.state.lastReport.coaching.related_edits = undefined;
const badDesk = bad.render();
assert.equal(bad.find(badDesk, 'revision-preview'), undefined);
assert.ok(bad.elements.get('revision-script'));
const help = s.R._helpPanel(s.context.App.state.lastReport, {key:'user_reason'}, {focusAttempts:2});
assert.match(help.textContent, /原来这样说/);
assert.match(help.textContent, /这次这样改/);
assert.ok(help.textContent.includes(lesson.why));
console.log('PASS revision preview: anchored edits, deletions, limits, text safety, explicit adoption, lossless undo branches, selection, storage, reload and retry comparison');
