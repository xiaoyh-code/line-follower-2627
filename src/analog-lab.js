import './analog-lab.css';
import { highlightArduino } from './arduino-code.js';

// Reflectance counts measured on the classroom car.
const white = 3500;
const black = 3900;
const midpoint = (white + black) / 2;

export function analogLabHtml(say) {
  return `<details id="analog-lab">
    <summary>${say('探頭彩蛋 · 黑線同白底之間，S1 讀到幾多？', 'Sensor extra · What does S1 read at the edge of the tape?')}</summary>
    <p>${say('課堂車喺白底讀到約 3500，黑膠帶就約 3900。將 S1 由白底移入黑線，估下讀數去到幾多會轉做 1。', 'On the classroom car, white gave a reading of about 3500 and black tape about 3900. Move the simulated S1 reading from white towards black. At what reading will it switch to 1?')}</p>
    <div class="analog-instrument">
      <div class="analog-field">
        <label for="analog-reading">${say('S1 模擬反射讀數', 'Simulated S1 reading')}</label>
        <span class="analog-number" data-reading-value aria-hidden="true">${white}</span>
        <input id="analog-reading" type="range" min="${white}" max="${black}" value="${white}" aria-describedby="analog-anchors">
        <div class="analog-anchors" id="analog-anchors"><span>${say('白底 3500', 'White 3500')}</span><span>${say('黑線 3900', 'Black 3900')}</span></div>
      </div>
      <div class="analog-field">
        <label for="analog-threshold">${say('軟件判斷門檻', 'Software threshold')}</label>
        <span class="analog-number" data-threshold-value aria-hidden="true">${midpoint}</span>
        <input id="analog-threshold" type="range" min="${white}" max="${black}" value="${midpoint}">
      </div>
      <output class="analog-result" for="analog-reading analog-threshold" aria-atomic="true">
        <span data-comparison data-no-i18n></span>
        <strong data-surface="white">${say('判為白底 · 0', 'Reads white · 0')}</strong>
        <strong data-surface="black" hidden>${say('判為黑線 · 1', 'Reads black · 1')}</strong>
      </output>
      <div class="analog-serial"><span>Serial Monitor</span><samp data-serial-line></samp></div>
    </div>
    <p>${say('3700 係今次黑白讀數嘅中點。試吓固定反射讀數，再調門檻。保留模擬量，就睇到讀數有幾接近分界。換場地或改咗板嘅高度，可以逐路再量黑同白，按新讀數定門檻。', '3700 is halfway between the two classroom readings. Hold the reading steady and move the threshold. The analog value shows how close the probe is to switching. When the surface or sensor height changes, measure black and white again for each channel to choose its threshold.')}</p>
    <p>${say('實車透過 I²C 地址 0x5D，由寄存器 6 起連讀 16 個 byte。每路兩個 byte，低位先到，依次係 S1 至 S8。將以下幾行放入課堂範例嘅 loop()，就可以用你揀嘅門檻判斷 S1，並排印出反射讀數同結果。', 'The classroom library reads 16 bytes starting at register 6 on I²C address 0x5D. Each pair holds one channel, low byte first, from S1 to S8. Put these lines inside loop() in the classroom sketch to print the S1 reading alongside the result for your chosen threshold.')}</p>
    <pre class="sensor-code" data-no-i18n><code></code></pre>
    <p>${say('想睇塊板自己儲存嘅門檻？原裝範例會並排印出每路嘅反射讀數同板上門檻。彩蛋嘅 0／1 由軟件計出，上面嘅手動 PID 實驗就模擬寄存器 5 嘅八位狀態。', 'The library example prints each analog reading alongside the threshold stored on the board. This exercise calculates its own 0 or 1 in software. The manual PID lab above simulates the eight-bit state from register 5.')}</p>
    <a class="analog-example" href="/downloads/02_Analog_Thresholds.ino" download>02_Analog_Thresholds.ino</a>
  </details>`;
}

export function setupAnalogLab(lab) {
  const reading = lab.querySelector('#analog-reading');
  const threshold = lab.querySelector('#analog-threshold');
  const readingText = lab.querySelector('[data-reading-value]');
  const thresholdText = lab.querySelector('[data-threshold-value]');
  const comparison = lab.querySelector('[data-comparison]');
  const whiteResult = lab.querySelector('[data-surface="white"]');
  const blackResult = lab.querySelector('[data-surface="black"]');
  const serialLine = lab.querySelector('[data-serial-line]');
  const sketch = lab.querySelector('pre code');

  function showSketch() {
    sketch.textContent = `get_AnalogVoltage_all_channel_IIC(&linefollower);
const uint16_t s1 = linefollower.AnalogVoltage_all_ch[0];
const bool onBlack = s1 >= ${threshold.value};
Serial.print(s1);
Serial.print(' ');
Serial.println(onBlack);`;
    highlightArduino(sketch);
  }

  function update() {
    const onBlack = reading.valueAsNumber >= threshold.valueAsNumber;
    readingText.textContent = reading.value;
    thresholdText.textContent = threshold.value;
    comparison.textContent = `${reading.value} ${onBlack ? '≥' : '<'} ${threshold.value}`;
    serialLine.textContent = `${reading.value} ${Number(onBlack)}`;
    whiteResult.hidden = onBlack;
    blackResult.hidden = !onBlack;
  }

  function openAtFragment() {
    if (location.hash === '#' + lab.id) lab.open = true;
  }

  lab.addEventListener('input', update);
  threshold.addEventListener('input', showSketch);
  window.addEventListener('hashchange', openAtFragment);
  update();
  showSketch();
  openAtFragment();
}
