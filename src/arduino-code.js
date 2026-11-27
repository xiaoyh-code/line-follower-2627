import './arduino-code.css';

const types = new Set((
  'auto bool boolean byte char class const constexpr double enum extern float inline int long ' +
  'short signed static struct typedef unsigned void volatile word size_t String ' +
  'WebServer MotorEncoderBoard linefollower_8ch NetworkMode'
).split(' '));
const control = new Set('break case continue default do else for if return switch while'.split(' '));
const objects = new Set(['Serial', 'Serial0', 'Serial1', 'Serial2', 'Wire', 'WiFi', 'ESP', 'MDNS']);

// Match the entire raw string first: the full classroom sketch embeds an HTML page.
const patterns = {
  raw: /(?:u8|u|U|L)?R"(?<delimiter>[^\s()\\"]{0,16})\([\s\S]*?\)\k<delimiter>"/,
  comment: /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/,
  string: /"(?:\\[\s\S]|[^"\\\r\n])*"/,
  character: /'(?:\\[\s\S]|[^'\\\r\n])*'/,
  directive: /#[ \t]*[A-Za-z_]+/,
  header: /<[A-Za-z_][\w./+-]*\.h(?:pp)?>/,
  number: /\b(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)[uUlLfF]*\b/,
  identifier: /[A-Za-z_]\w*/,
};
const sketchTokens = new RegExp(Object.entries(patterns)
  .map(([name, pattern]) => `(?<${name}>${pattern.source})`).join('|'), 'g');

function tokenStyle(match, source) {
  const token = match[0];
  const { groups } = match;
  if (groups.comment) return 'comment';
  if (groups.directive) return 'control';
  if (groups.character) return 'type';
  if (!groups.identifier) return 'literal';
  if (control.has(token)) return 'control';
  if (types.has(token) || /^u?int(?:8|16|32|64)_t$/.test(token) || token === 'setup' || token === 'loop') return 'type';
  if (objects.has(token)) return 'object';
  if (token === 'sizeof') return '';
  if (/^\s*\(/.test(source.slice(match.index + token.length))) return 'function';
  if (token === 'true' || token === 'false' || /^[A-Z][A-Z0-9_]+$/.test(token)) return 'literal';
  return '';
}

export function highlightArduino(codeElement) {
  const source = codeElement.textContent;
  const fragment = document.createDocumentFragment();
  let plainStart = 0;
  for (const match of source.matchAll(sketchTokens)) {
    const style = tokenStyle(match, source);
    if (!style) continue;
    fragment.append(source.slice(plainStart, match.index));
    const span = document.createElement('span');
    span.className = 'ino-' + style;
    span.textContent = match[0];
    fragment.append(span);
    plainStart = match.index + match[0].length;
  }
  fragment.append(source.slice(plainStart));
  codeElement.classList.add('arduino-code');
  codeElement.setAttribute('data-no-i18n', '');
  codeElement.replaceChildren(fragment);
}
