export const controlFields = [
  { key: 'p', label: '比例增益', symbol: 'P', description: '按目前的循線偏差修正轉向。', min: 0, max: 8, step: 0.1, digits: 1 },
  { key: 'i', label: '積分增益', symbol: 'I', description: '累積持續偏差，修正車身長時間偏向一側的情況。', min: 0, max: 2, step: 0.01, digits: 2 },
  { key: 'd', label: '微分增益', symbol: 'D', description: '按偏差的變化調整轉向，減少擺動。', min: 0, max: 2, step: 0.001, digits: 3 },
  { key: 'speed', label: '基礎速度指令', symbol: '0–23', description: '每 10 ms 的編碼器目標計數。實際輪速見下方 cm/s。', min: 0, max: 23, step: 1, digits: 0 },
];
