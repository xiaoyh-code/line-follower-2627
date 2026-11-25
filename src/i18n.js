const preferenceKey = 'line-follower-lab.language';
const english = new Map();
const chinese = new Map();
const subscribers = new Set();
const original = new WeakMap();
const skip = 'script, style, svg:not([role="img"]), [data-no-i18n]';
const attributes = ['aria-label', 'aria-description', 'aria-valuetext', 'title', 'placeholder', 'alt', 'data-label'];
let language = 'zh-HK';
let observer;

export function registerTranslations(entries) {
  for (const [source, target] of Object.entries(entries)) {
    english.set(source, target);
    if (!chinese.has(target)) chinese.set(target, source);
  }
}

export const getLanguage = () => language;
export const t = (zh, en) => language === 'en' ? en : zh;
export const localize = text => language === 'en' ? english.get(text) ?? text : text;

export function onLanguageChange(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function translateValue(node, key, value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const remembered = original.get(node)?.get(key);
  const source = remembered?.rendered === trimmed ? remembered.source :
    english.has(trimmed) ? trimmed : chinese.get(trimmed);
  if (!source) return;
  const rendered = language === 'en' ? english.get(source) : source;
  if (!original.has(node)) original.set(node, new Map());
  original.get(node).set(key, { source, rendered });
  if (rendered === trimmed) return;
  const translated = value.replace(trimmed, () => rendered);
  if (key === null) node.nodeValue = translated;
  else node.setAttribute(key, translated);
}

function translateTree(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.parentElement?.closest(skip)) translateValue(node, null, node.nodeValue);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest(skip)) return;
  for (const attr of attributes) {
    if (node.hasAttribute(attr)) translateValue(node, attr, node.getAttribute(attr));
  }
  if (node.matches('select[data-language-picker]')) node.value = language;
  for (const child of node.childNodes) translateTree(child);
}

export function setLanguage(value) {
  if (value !== 'en' && value !== 'zh-HK') return;
  language = value;
  document.documentElement.lang = value;
  try { localStorage.setItem(preferenceKey, value); } catch { /* Storage is optional. */ }
  translateTree(document.documentElement);
  for (const callback of subscribers) callback(value);
}

export function languagePickerHtml() {
  return '<select data-language-picker aria-label="介面語言"><option lang="zh-HK" value="zh-HK" data-no-i18n>繁體中文</option><option lang="en" value="en" data-no-i18n>English</option></select>';
}

export function startLanguage() {
  if (observer) return;
  try { if (localStorage.getItem(preferenceKey) === 'en') language = 'en'; } catch { /* Use the classroom default. */ }
  document.documentElement.lang = language;
  translateTree(document.documentElement);
  document.addEventListener('change', event => {
    if (event.target.matches('select[data-language-picker]')) setLanguage(event.target.value);
  });
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) translateTree(node);
      } else if (record.type === 'characterData') {
        translateTree(record.target);
      } else if (!record.target.closest(skip) && record.target.hasAttribute(record.attributeName)) {
        translateValue(record.target, record.attributeName, record.target.getAttribute(record.attributeName));
      }
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: attributes });
}
