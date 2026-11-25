import { onLanguageChange, t } from './i18n.js';

export function formatStartOffset(mm) {
  if (mm === 0) return t('置中', 'Centred');
  const distance = Math.abs(mm) + ' mm';
  return mm > 0
    ? t('車身向左偏 ' + distance, 'Car offset ' + distance + ' left')
    : t('車身向右偏 ' + distance, 'Car offset ' + distance + ' right');
}

export function setupStartOffset(select, initial) {
  for (const mm of [55, 40, 25, 15, 10, 5, 0, -5, -10, -15, -25, -40, -55]) {
    select.add(new Option(formatStartOffset(mm), String(mm)));
  }
  select.value = String(initial);
  onLanguageChange(() => {
    for (const option of select.options) option.textContent = formatStartOffset(Number(option.value));
  });
}
