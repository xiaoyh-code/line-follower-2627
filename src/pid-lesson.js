import { registerTranslations, t } from './i18n.js';
import { bindSensorReadout } from './sensor-readout.js';
import { gainDiagram } from './pid-diagrams.js';
import { setupProbeSteps } from './probe-step-controls.js';
import './sensor-lab.css';

import { equation, math } from './math.js';

// Register each authored phrase with the site's translator. Switching language
// leaves the student's open explanations, focus and scroll position intact.
export function setupPidLesson(container) {
  const translations = {};
  const say = (zh, en) => {
    translations[zh] = en;
    return t(zh, en);
  };

  const weights = [-7, -5, -3, -1, 1, 3, 5, 7];
  const sign = weight => weight < 0 ? '−' + Math.abs(weight) : '+' + weight;
  const html = `
    <header class="lesson-intro">
      <h2 id="pid-lesson-title">${say('PID 循線原理', 'How PID steers the car')}</h2>
      <p>${say('先讀車頭八盞燈，判斷黑線偏向邊一邊，再用 P、I、D 算出左右輪應該相差幾多。以下例子採用預設安裝，車頭向前時 S1 喺最左邊。', 'Read the eight lamps to locate the line, then use P, I and D to decide how much faster one wheel should turn. These examples use the default mounting, with S1 on the left when the car faces forward.')}</p>
    </header>

    <section class="lesson-section" id="sensor-order-guide" tabindex="-1" aria-labelledby="sensor-order-title">
      <h3 id="sensor-order-title">${say('點讀 Library 嘅八個 bit', 'Read the eight sensor bits')}</h3>
      <p>${say('課堂車讀到黑線係 1，白色反光底係 0。按第 5 章工作紙嘅安裝方向，沿架車前進方向望，S1 喺左，S8 喺右。', 'On the classroom car, black tape reads 1 and the reflective white surface reads 0. With the mounting shown in the Chapter 5 worksheet, S1 is on the left and S8 on the right, facing the direction of travel.')}</p>
      <section class="sensor-reader" id="probe-lab" aria-labelledby="probe-lab-title" tabindex="-1">
        <h4 id="probe-lab-title">${say('手動探頭實驗', 'Manual sensor lab')}</h4>
        <p id="probe-hint">${say('撳 S1 至 S8 揀邊幾個探頭見到黑線。1 係黑線，0 係白底。', 'Toggle S1 to S8 to choose which sensors see the black line. A 1 means black tape and a 0 means white.')}</p>
        <div class="probe-strip" role="group" aria-label="${say('選擇見到黑線嘅探頭', 'Select sensors over black tape')}" aria-describedby="probe-hint">
          ${weights.map((_, i) => `<button type="button" class="probe-toggle" data-probe="${i}" aria-label="S${i + 1}" aria-pressed="false"><span class="probe-name">S${i + 1}</span><span class="probe-value" data-channel-reading data-no-i18n>—</span></button>`).join('')}
        </div>
        <div data-decoded>
          <dl class="sensor-result" aria-live="polite">
            <div><dt>${say('原始 byte（bit 7 → 0）', 'Register byte (bit 7 → 0)')}</dt><dd data-register></dd></div>
            <div><dt>Serial Monitor (S1 → S8)</dt><dd data-serial></dd></div>
            <div><dt>${say('黑線 · 讀 1', 'Black · reads 1')}</dt><dd data-black></dd></div>
            <div><dt>${say('白底 · 讀 0', 'White · reads 0')}</dt><dd data-white></dd></div>
          </dl>
        </div>
        <details class="probe-entry">
          <summary>${say('輸入或貼上八位讀數', 'Type or paste eight bits')}</summary>
          <div class="sensor-fields">
            <label for="sensor-format"><span>${say('讀數來源', 'Reading source')}</span><select id="sensor-format">
              <option value="example">${say('原裝 Example（S1 → S8）', 'Original example (S1 → S8)')}</option>
              <option value="register">${say('原始 byte（bit 7 → bit 0）', 'Register byte (bit 7 → bit 0)')}</option>
            </select></label>
            <label for="sensor-digits"><span>${say('八位讀數（可連空格貼上）', 'Eight digits (spaces allowed)')}</span><input id="sensor-digits" inputmode="numeric" autocomplete="off" spellcheck="false" value="10001000" aria-describedby="sensor-digits-error"></label>
          </div>
        </details>
        <p id="sensor-digits-error" role="status" hidden>${say('請輸入八個 0 或 1，或者撳一個探頭，由全白重新揀。', 'Enter eight zeros or ones, or tap a sensor to start a new pattern from all white.')}</p>
        <div class="probe-control-panel">
          <p>${say('每撳一次單步，控制器就用上面嘅讀數計 10 ms。積分同上次偏差會留到下一步；賽道上架車獨立運行。', 'Each step uses the selected readings for one 10 ms control update. The integral and previous error carry over to the next step. The car on the track runs separately.')}</p>
          <div id="probe-controls"></div>
          <div class="probe-actions">
            <button id="probe-step" type="button" aria-controls="probe-tick"><svg aria-hidden="true"><use href="#ic-step"></use></svg>${say('用呢組讀數行一步 +10 ms', 'Step with these readings +10 ms')}</button>
            <button id="probe-reset" type="button" aria-controls="probe-tick">${say('重設 PID 記錄', 'Reset PID history')}</button>
          </div>
        </div>
        <details id="probe-tick" class="step-terms" hidden>
          <summary><span>${say('上一步 PID 計算', 'Last PID update')}</span> <span id="probe-wheel-report" aria-live="polite" data-no-i18n></span></summary>
          <div id="probe-pid-view"></div>
        </details>
      </section>
      <p>${say('I²C 嘅狀態寄存器（地址 0x5D，寄存器編號 5）一次傳回八路讀數，共一個 byte。Library 將佢存入 StateReg_OriginData，再用以下一行拆出每個通道。', 'The sensor at I²C address 0x5D returns all eight channels in one byte from register 5. The library stores the byte in StateReg_OriginData and extracts each channel with this line.')}</p>
      <pre class="sensor-code" data-no-i18n><code>obj-&gt;state_all_ch[len] = (obj-&gt;StateReg_OriginData &gt;&gt; len) &amp; 0x01;</code></pre>
      <p>${say('len 由 0 數到 7。右移 len 位，將想讀嗰位移到最右；再同 1 做 AND，就只留下嗰一位。陣列 [0] 係 bit 0（S1），[3] 係 bit 3（S4），如此類推，[7] 係 bit 7（S8）。反轉安裝只會改變實體左右。', 'The loop counts len from 0 to 7. Shifting right by len moves the selected bit to the rightmost position. AND with 1 keeps that bit. Array index [0] holds bit 0 (S1), [3] holds bit 3 (S4), and [7] holds bit 7 (S8). Reversing the mounting only changes physical left and right.')}</p>
      <p>${say('喺 Arduino IDE 揀 File → Examples → LineFollowerLearn8CH → 01_Digital_States。用 115200 baud 開 Serial Monitor，每隔約 200 ms 就會見到新一行。', 'In Arduino IDE, choose File → Examples → LineFollowerLearn8CH → 01_Digital_States. Open Serial Monitor at 115200 baud. A new row appears about every 200 ms.')}</p>
      <pre class="sensor-code" data-no-i18n><code>detect_state_all_channel_IIC(&amp;linefollower);
for (int i = 0; i &lt; 8; ++i) {
  Serial.print(linefollower.state_all_ch[i]);
  Serial.print(' ');
}
Serial.println();</code></pre>
      <p>${say('原裝範例先讀取感測板，再由陣列 [0] 印到 [7]，即 S1 → S8。睇 Serial Monitor 就由左數；如果睇二進制寫法嘅原始 byte，最右先係 bit 0（S1）。', 'The example refreshes the sensor data and prints array indices [0] through [7], in S1 → S8 order. Start at the left in Serial Monitor. In a binary register value, bit 0 (S1) is at the far right.')}</p>
      <p>${say('架車停定後，先將八路都對住白底，再移一小段黑膠紙到 S1 正下方。Serial Monitor 預期由八個 0 變成 1 0 0 0 0 0 0 0，對應原始 byte 0x01。', 'To check the mapping, keep the car still over a white surface, then place black tape under S1 only. The expected Serial Monitor reading changes from eight zeros to 1 0 0 0 0 0 0 0. The register value is then 0x01.')}</p>
      <p><a href="/downloads/01_Digital_States.ino" download="01_Digital_States.ino">${say('下載原裝 01_Digital_States.ino', 'Download the original 01_Digital_States.ino')}</a></p>
    </section>

    <section class="lesson-section" id="pid-sensing" tabindex="-1" aria-labelledby="pid-sensing-title">
      <h3 id="pid-sensing-title">${say('由八盞燈計出偏差', 'Find the error from the eight lamps')}</h3>
      <p>${say('模擬畫面會亮着讀到黑線（原始值為 1）嘅通道。將呢啲通道嘅權重加埋，再除以佢哋嘅數目，就得到循線偏差 e。', 'The simulator highlights channels over black tape (raw value 1). Add their weights and divide by the number of these channels to get the line error, e.')}</p>
      <table class="lesson-weights">
        <caption>${say('各通道嘅權重', 'Weight of each sensor channel')}</caption>
        <thead><tr>${weights.map((_, i) => `<th scope="col">S${i + 1}</th>`).join('')}</tr></thead>
        <tbody><tr>${weights.map(w => `<td>${sign(w)}</td>`).join('')}</tr></tbody>
      </table>
      <p>${say('S4、S5 同時亮起，黑線喺中間。', 'With S4 and S5 lit, the line is centred.')}</p>
      ${equation`e_k=\dfrac{-1+1}{2}=0`}
      <p>${say('換成 S6、S7 亮起，黑線喺車頭右邊。', 'With S6 and S7 lit, the line is to the right of the nose.')}</p>
      ${equation`e_k=\dfrac{3+5}{2}=+4`}
    </section>

    <section class="lesson-section" id="pid-gains" tabindex="-1" aria-labelledby="pid-gains-title">
      <h3 id="pid-gains-title">${say('P、I、D 各自做咩？', 'What does each gain do?')}</h3>
      <p>${say('課本用連續時間寫 PID。由左至右，三項分別用到而家嘅偏差、由起步累積嘅偏差，同埋偏差嘅變化率。', 'In the continuous-time PID equation, the three terms use the current error, the error accumulated since the start, and the rate at which the error changes.')}</p>
      ${equation`u(t)=K_P\,e(t)+\allowbreak K_I\!\int_0^t e(\tau)\,\mathrm{d}\tau+\allowbreak K_D\,\dfrac{\mathrm{d}e(t)}{\mathrm{d}t}`}
      <p>${say('控制器每隔 10 ms 計算一次。下標 k 代表今次讀數，k−1 代表上一次。面板上嘅 P、I、D 數值分別設定三項修正嘅增益。', 'The controller updates every 10 ms. The subscript k means the current sample, and k−1 means the previous one. The P, I and D settings on the panel are the three gains.')} ${math`\Delta t=0.010\,\mathrm{s}`}</p>
      <div class="lesson-gains">
        <article class="lesson-gain">
          <h4><span class="gain-symbol">P</span> ${say('比例', 'Proportional')}</h4>
          ${gainDiagram('P', say)}
          <p>${say('睇而家偏幾遠。同一個增益下，偏差大一倍，比例修正就大一倍。黑線喺正中間時，呢一項係 0。P 太大，車頭可能會越過中線，再向另一邊大幅修正。', 'P responds to the current error. At the same gain, twice the error gives twice the proportional correction. This term is zero when the line is centred. Too much P can steer the car past the line and trigger a large correction back the other way.')}</p>
          ${equation`u_P=K_P\,e_k`}
        </article>
        <article class="lesson-gain">
          <h4><span class="gain-symbol">I</span> ${say('積分', 'Integral')}</h4>
          ${gainDiagram('I', say)}
          <p>${say('睇架車偏咗幾耐。如果黑線一直喺同一側，就算每次偏差好細，累積值 A 都會增加修正。A 嘅單位係偏差·秒。模擬器將 A 限喺 −20 至 +20，避免積分一直增長。', 'I adds up error over time. A small error that stays on the same side builds up a correction. The accumulated error A is measured in error units × seconds. The simulator limits it to −20 through +20 to prevent it growing indefinitely.')}</p>
          ${equation`A_k=\operatorname{clip}(A_{k-1}+e_k\,\Delta t,\allowbreak -20,20)`}
          ${equation`u_I=K_I\,A_k`}
        </article>
        <article class="lesson-gain">
          <h4><span class="gain-symbol">D</span> ${say('微分', 'Derivative')}</h4>
          ${gainDiagram('D', say)}
          <p>${say('睇偏差變得幾快。黑線由右邊移返中央，正偏差開始收細，D 項就會變負，減少向右轉嘅修正。連續兩次偏差相同，D 項就係 0。探頭讀數跳動時，D 太大會令輪指令急變。', 'D responds to how quickly the error changes. As the line moves from the right towards the centre, the positive error shrinks. D becomes negative and eases the right turn. Two equal errors give a zero D term. A high D gain can produce abrupt wheel commands when the sensor reading jumps.')}</p>
          ${equation`r_k=\dfrac{e_k-e_{k-1}}{\Delta t}`}
          ${equation`u_D=K_D\,r_k`}
        </article>
      </div>
    </section>

    <section class="lesson-section" id="pid-steering" tabindex="-1" aria-labelledby="pid-steering-title">
      <h3 id="pid-steering-title">${say('由轉向修正到左右輪', 'Turn the correction into wheel commands')}</h3>
      <p>${say('三項加埋得到轉向修正 u。基礎速度指令用 B 表示。正修正令左輪指令增加、右輪指令減少，架車會向右轉。負修正就會向左轉。', 'Add the three terms to find the steering correction u. B is the base speed command. A positive correction increases the left command and reduces the right command, steering right. A negative correction steers left.')}</p>
      ${equation`u=\operatorname{clip}(u_P+u_I+u_D,\allowbreak -8,8)`}
      ${equation`L=\operatorname{clip}(\operatorname{trunc}(B+u),\allowbreak 0,23)`}
      ${equation`R=\operatorname{clip}(\operatorname{trunc}(B-u),\allowbreak 0,23)`}
      <p>${say('clip 會將超出範圍嘅值拉返到最近嘅上限或下限。trunc 會向零截去小數，例如 12.8 變成 12。L 同 R 嘅單位係每 10 ms 嘅目標編碼器計數。畫面嘅 cm/s 係模擬車輪實際轉動產生嘅速度。', 'clip limits a value to the stated range. trunc drops the fractional part towards zero, so 12.8 becomes 12. L and R are target encoder counts per 10 ms. The wheel speeds shown in cm/s come from the simulated wheels’ actual rotation.')}</p>
      <details class="lesson-loss">
        <summary>${say('八盞燈全熄，架車會點行？', 'What happens when all eight lamps go out?')}</summary>
        <p>${say('冇探頭見到線，就冇新偏差可以平均。程式會清零積分，保留最後一次見線嘅偏差。開啟「原程式搜線」並有非零增益時，最後偏差向左就用左 3、右 23 向左搵線。向右就用左 23、右 3 向右搵線。', 'With no lit channels, there is no new error to average. The controller clears the integral and remembers the last error from a visible line. With firmware search on and at least one nonzero gain, a last error to the left gives L = 3 and R = 23 to search left. A last error to the right gives L = 23 and R = 3.')}</p>
        <p>${say('最後偏差為 0、關閉搜線，或者三個增益都係 0，失線時兩輪都會用基礎指令直行。基礎速度設為 0 就會停車。', 'If the last error was zero, search is off, or all three gains are zero, both wheels get the base command after line loss. Setting the base speed to zero stops the car.')}</p>
      </details>
    </section>

    <section class="lesson-section lesson-worked" id="pid-example" tabindex="-1" aria-labelledby="pid-example-title">
      <h3 id="pid-example-title">${say('模擬器例題 · 計一次右轉', 'Worked example · one right turn')}</h3>
      <p>${say('今次得 S6、S7 亮起。假設上次偏差係 +2，上次累積值係 1.96，基礎速度指令係 10。設 P = 1、I = 0.5、D = 0.005。', 'Only S6 and S7 are lit. The previous error was +2, the previous accumulated error was 1.96, and the base command is 10. Use P = 1, I = 0.5 and D = 0.005.')}</p>
      <ol class="lesson-calculation">
        <li><strong>${say('計偏差', 'Read the error')}</strong> ${equation`e_k=\dfrac{3+5}{2}=4`}</li>
        <li><strong>${say('計三項修正', 'Calculate the three terms')}</strong>
          ${equation`u_P=1\times 4=4`}
          ${equation`u_I=0.5\times(1.96+4\times 0.010)=1`}
          ${equation`u_D=0.005\times\dfrac{4-2}{0.010}=1`}
        </li>
        <li><strong>${say('預測車頭方向', 'Predict the turn')}</strong>
          ${equation`u=4+1+1=6`}
          ${equation`L=10+6=16`}
          ${equation`R=10-6=4`}
          <p>${say('左輪加快，車頭向右追返條黑線。', 'The faster left wheel turns the nose right, towards the line.')}</p>
        </li>
      </ol>
    </section>

    <section class="lesson-section" id="steering-gains-guide" tabindex="-1" aria-labelledby="steering-guide-title">
      <h3 id="steering-guide-title">${say('P、D 同車頭搖擺', 'P, D and steering oscillation')}</h3>
      <p>${say('用課堂 Main 嘅誤差單位比較。探頭權重由 −7 至 +7，每 0.010 s 更新一次，轉向修正 u 限於 −8 至 +8。模擬器可試 Kp 0–8、Ki 0–2、Kd 0–2；實車 Main 嘅增益輸入欄並無設定上限。', 'Use the classroom sketch’s error units. Sensor weights span −7 to +7, the simulator updates every 0.010 s, and correction u is limited to ±8. The lab lets you test Kp from 0 to 8, Ki from 0 to 2 and Kd from 0 to 2. The physical sketch has no upper limit on its gain inputs.')}</p>
      <p>${say('偏差由 0 跳到 +1 嗰一步，變化率係 100。用 Kp = 2、Ki = 0、Kd = 1.5，D 項已經係 +150。基礎速度 7 時，轉向限幅同輪速下限決定最後指令。', 'When error jumps from 0 to +1 in one update, its rate is 100. With Kp = 2, Ki = 0 and Kd = 1.5, the D term alone is +150. At base command 7, the correction limit and minimum wheel command determine what reaches each wheel.')}</p>
      ${equation`u=\operatorname{clip}\bigl(2\times 1+1.5\times\dfrac{1-0}{0.010},\allowbreak -8,8\bigr)=8`}
      ${equation`L=7+8=15`}
      ${equation`R=\operatorname{clip}(7-8,0,23)=0`}
      <p>${say('偏差連續兩次相同，D 項就會歸零。相反，讀數每跳一格，Kd = 1.1 同 1.9 都可能撞到同一個轉向上限。Pololu 嘅範例直接用兩次偏差之差，佢嘅增益要配返嗰份程式嘅單位。', 'If the error stays the same for two updates, D returns to zero. On a one-unit jump, Kd = 1.1 and Kd = 1.9 can both hit the same steering limit. Pololu’s example uses the difference between successive errors, so its gain values use a different scale.')} <a href="https://www.pololu.com/docs/0J21/7.c">Pololu 3pi PID</a></p>
      <h4>${say('同一條直路，車頭擺幾闊？', 'How wide is the swing on the same straight?')}</h4>
      <p>${say('以老師喺實車試到最穩定嗰組為基準。Kp = 2，Kd 約 1 點幾（示範取 1.5），速度指令 7。三次試跑都關閉 I，用預設賽道、相同左偏 15 mm 起點同 40 ms 額外摩打指令延遲。40 ms 係教學模型嘅假設，實車延遲有待量度。', 'Start with the teacher’s best settings on the physical car. Kp = 2, Kd is between 1 and 2 (represented by 1.5), and the base command is 7. I is zero in all three runs. On the stock circuit, each starts 15 mm left with 40 ms added motor command delay. The delay is a modelling assumption and has yet to be measured on the car.')}</p>
      <figure class="steering-traces">
        <img width="520" height="266" loading="lazy" decoding="async" src="/worksheets/steering-straight.svg" alt="${say('課堂基準嘅車頭逐漸指返正前方。加 P、減 D 後，車頭沿同一段直路反覆向左、向右擺。', 'The baseline heading settles near straight ahead. With higher P and lower D the heading repeatedly swings left and right along the same straight.')}">
        <figcaption>${say('橫軸係架車行到呢段直路嘅位置（米）。縱軸係車頭角度，0° 代表正前方。', 'Horizontal position is measured in metres from the start of this straight. Vertical position shows the car’s heading in degrees. At 0° the nose points straight ahead.')}</figcaption>
      </figure>
      <table class="lesson-weights steering-results">
        <caption>${say('MuJoCo 車身朝向，最大角減最小角', 'Simulated chassis heading, maximum minus minimum')}</caption>
        <thead><tr><th scope="col">${say('增益', 'Gains')}</th><th scope="col">${say('起步直路', 'Opening straight')}</th><th scope="col">${say('回程直路', 'Return straight')}</th></tr></thead>
        <tbody><tr><th scope="row">P 2 · D 1.5</th><td>6.5°</td><td>3.2°</td></tr><tr><th scope="row">P 4 · D 0.01</th><td>15.2°</td><td>12.7°</td></tr><tr><th scope="row">P 4 · D 0</th><td>15.9°</td><td>13.2°</td></tr></tbody>
      </table>
      <p>${say('基準組起步時修正初始偏移。加 P、減 D 嗰組嘅車頭就反覆擺向直路兩側。第一次兜返起步直路，量同一段 0.87 m，用 ±1° 判斷車頭由一側擺到另一側，兩組分別係 0 次同 21 次。三組都完成一圈，途中冇失線。', 'The baseline corrects the starting offset. With higher P and lower D, the nose repeatedly swings to opposite sides of the straight-ahead direction. On the same 0.87 m stretch on the first return, the heading alternates beyond ±1° zero times for the baseline and 21 times for higher P and lower D. All three complete a lap without losing the line.')}</p>
      <p>${say('固定 P = 4，每次只改 D，再重設實驗。D 由 1.5 改到 1.2，回程直路擺幅都係 2.5°。再試 0.10 同 0.05，擺幅分別係 2.9° 同 10.6°。留意邊一組只喺起步時擺，邊一組兜返直路仍然搖頭。', 'Keep P at 4. Change only D and reset the run each time. At D = 1.5 and 1.2, the return-straight range is 2.5° in both cases. Try 0.10 and 0.05 next. The ranges are 2.9° and 10.6°. Which car settles after the start, and which keeps swinging on the return straight?')}</p>
      <p>${say('揀車頭近鏡，留意直路上嘅角度圖。有需要可以用同一個起點將額外延遲改為 0 ms，再行一次。', 'Use the fixed-orientation close-up and watch the heading trace on a straight. To isolate the effect of lag, set the added delay to 0 ms and repeat from the same offset.')}</p>
      <p class="steering-links"><a href="?trial=pd#simulator">${say('試課堂基準', 'Try the classroom baseline')}</a><a href="?trial=swing#simulator">${say('試加 P、減 D', 'Try higher P and lower D')}</a><a href="?trial=p#simulator">${say('試純 P', 'Try P only')}</a></p>
    </section>

    <section class="lesson-section" id="pid-experiments" tabindex="-1" aria-labelledby="pid-experiments-title">
      <h3 id="pid-experiments-title">${say('用同一個彎測試你嘅預測', 'Test your prediction on the same bend')}</h3>
      <p>${say('呢組彎道練習用預設賽道，將車速調至 10，揀置中起步同 0 ms 額外延遲。每次重設起點，只改一個增益。揀感測板近鏡同 0.5× 播放，對照燈號、轉向修正同左右輪指令。', 'For this bend exercise, select the stock circuit, set speed to 10 and choose a centred start with 0 ms extra delay. Reset to the start each time and change one gain at a time. Select the sensor camera and 0.5× playback to compare the lamps, steering correction and wheel commands.')}</p>
      <ol class="lesson-experiments">
        <li>${say('設 P = I = D = 0。第一個彎開始時，兩輪指令有冇變？再將 P 改成 1，觀察第一次只有左側探頭見線時，邊個輪嘅指令較大。', 'Start with P = I = D = 0. Do the wheel commands change at the first bend? Set P to 1 and repeat. When only the left channels see the line, which wheel gets the larger command?')}</li>
        <li>${say('保持 P = 1、D = 0。先用 I = 0，再用 I = 0.5。搵一段黑線持續偏向同一側嘅路，比較偏差相同時嘅轉向修正。', 'Keep P = 1 and D = 0. Compare I = 0 with I = 0.5. Find a stretch where the error stays on one side. Compare the correction at equal error readings.')}</li>
        <li>${say('將 I 還原為 0，比較 D = 0 同 D = 0.005。留意燈號轉換嗰一刻，記低轉向修正，同埋之後架車有冇越過黑線中心。', 'Return I to zero and compare D = 0 with D = 0.005. Record the correction as the pattern of lights changes. Does the car then cross the centre of the line?')}</li>
      </ol>
    </section>`;
  registerTranslations(translations);
  container.innerHTML = html;
  const sensors = container.querySelector('#sensor-order-guide');
  bindSensorReadout(sensors, setupProbeSteps(sensors));
}
