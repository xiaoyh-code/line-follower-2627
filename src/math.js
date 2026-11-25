import katex from 'katex';
import 'katex/dist/katex.min.css';

// Inline mode allows breaks at mathematical operators. Display-style fractions
// keep each numerator and denominator legible in both lesson and live working.
const options = { output: 'htmlAndMathml', strict: 'error', throwOnError: true };

export function math(strings, ...values) {
  const latex = String.raw(strings, ...values);
  return '<span class="typeset-math" data-no-i18n>' + katex.renderToString(latex, options) + '</span>';
}

export function equation(strings, ...values) {
  return '<p class="lesson-formula">' + math(strings, ...values) + '</p>';
}

export function showMath(element, latex) {
  if (element.dataset.renderedTex === latex) return;
  katex.render(latex, element, options);
  element.dataset.renderedTex = latex;
}
