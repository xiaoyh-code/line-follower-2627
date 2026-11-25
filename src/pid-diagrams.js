import './pid-diagrams.css';

const plates = {
  P: {
    file: 'proportional',
    alt: ['偏差對時間圖，直線標出 20 ms 嗰個實心點嘅高度。', 'Error against time. A vertical segment marks the height of the filled point at 20 ms.'],
    caption: ['20 ms 嗰刻讀到嘅偏差係 +4，P 用嘅就係呢個值。', 'At 20 ms the error is +4. P uses this latest reading.'],
  },
  I: {
    file: 'integral',
    alt: ['斜紋長方形由 10 ms 延伸到 20 ms，高度等於最新偏差 4。', 'A hatched rectangle spans 10 to 20 ms. Its height is the latest error, 4.'],
    caption: ['呢一步闊 0.010 秒、高 4。長方形嘅面積令累積偏差增加 0.04 偏差·秒。', 'This step is 0.010 seconds wide and 4 units high. Its area adds 0.04 error-seconds to the integral.'],
  },
  D: {
    file: 'derivative',
    alt: ['斜線連接 10 ms 嘅空心點同 20 ms 嘅實心點，虛線標出兩點嘅高低差。', 'A sloping line connects the open point at 10 ms and the filled point at 20 ms. Dashed guides mark the rise and run.'],
    caption: ['偏差喺 10 ms 內由 +2 升到 +4。連住兩點嘅斜率係每秒 +200 個偏差單位。', 'The error rises from +2 to +4 in 10 ms. The slope between the two samples is +200 error units per second.'],
  },
};

export function gainDiagram(term, say) {
  const { file, alt, caption } = plates[term];
  return `<figure class="gain-diagram">
    <img src="/worksheets/pid-${file}.webp" width="960" height="570"
      loading="lazy" decoding="async" alt="${say(...alt)}">
    <figcaption>${say(...caption)}</figcaption>
  </figure>`;
}
