import './trials-ui.css';
import { onLanguageChange, t } from './i18n.js';

const ROUNDS = 8;
const byId = id => document.getElementById(id);
const number = (value, digits = 1) => Number(value).toFixed(digits);
const lostSeconds = trial => trial.metrics.lostTime;

export function setupTrialPanel({ getInputs, renderOrigin, renderFrame, resetTrail, showGhosts, setGhostVisibility, setStatus, applyGains }) {
  const start = byId('trial-start'), stop = byId('trial-stop'), reset = byId('trial-reset');
  const apply = byId('trial-apply'), exportButton = byId('trial-export');
  const rows = byId('trial-rows'), note = byId('trial-note'), progress = byId('trial-progress');
  const rate = byId('trial-rate'), ghosts = byId('trial-ghosts');
  let active = false;
  let worker = null;
  let pending = [];
  let completed = [];
  let batchInputs = null;
  let allReceived = false;
  let auto = false;
  let player = null;
  let animation = 0;
  let expected = ROUNDS;
  let appliedIndex = null;
  let syncPlaybackRate = null;
  const currentMessages = new Map();
  let stageMessage = null;

  function showMessage(element, zh, en) {
    currentMessages.set(element, [zh, en]);
    element.textContent = t(zh, en);
  }

  function showStage(kind, zh, en) {
    stageMessage = [kind, zh, en];
    setStatus(kind, t(zh, en));
  }

  function showSetup() {
    const { speed, recovery, sensorOrder, commandDelayMs = 0, startOffsetMm = 0 } = getInputs();
    byId('trial-speed').textContent = speed + ' / 23';
    const left = sensorOrder === 's8-left' ? 'S8' : 'S1';
    const search = recovery ? t('原程式搜線', 'Firmware search') : t('失線直行', 'Straight ahead on loss');
    const delay = t('指令延遲 ', 'Command delay ') + commandDelayMs + ' ms';
    const offset = t('起步偏移 ', 'Start offset ') + startOffsetMm + ' mm';
    byId('trial-setup').textContent = [t(left + ' 在左', left + ' on the left'), search, delay, offset].join(' · ');
  }

  function best() {
    const champion = completed.at(-1)?.bestIndex;
    return completed.find(t => t.index === champion) || completed[0];
  }

  function updateControls() {
    const busy = auto || Boolean(player);
    const champion = best();
    start.disabled = busy || !(getInputs().speed > 0);
    start.querySelector('span').textContent = completed.length ? t('重新試跑', 'Run again') : t('開始試跑', 'Start trials');
    stop.disabled = !busy;
    reset.disabled = !busy && !completed.length && !batchInputs;
    apply.disabled = busy || !champion || appliedIndex === champion.index;
    apply.textContent = champion && appliedIndex === champion.index
      ? t('已套用至手動模式', 'Applied to manual mode') : t('套用最佳 PID 至手動模式', 'Apply best PID to manual mode');
    exportButton.disabled = !completed.length;
    for (const button of rows.querySelectorAll('button')) button.disabled = busy;
  }

  function updateHistory() {
    byId('trial-empty').hidden = completed.length > 0;
    byId('trial-table').hidden = !completed.length;
    byId('trial-summary').hidden = !completed.length;
    const champion = best();
    const baseline = completed[0];
    rows.replaceChildren();
    for (const trial of completed) {
      const tr = document.createElement('tr');
      const n = trial.index + 1;
      const label = trial.index === 0 ? t('（基準）', ' (baseline)') : '';
      const bestMark = trial === champion && completed.length > 1 ? t(' · 最佳', ' · Best') : '';
      const count = trial.metrics.lossCount;
      tr.classList.toggle('trial-best', trial === champion && completed.length > 1);
      const data = [
        [t('輪次', 'Round'), t('第 ' + n + ' 輪', 'Round ' + n) + label + bestMark],
        ['P / I / D', [trial.params.p, trial.params.i, trial.params.d].join(' / ')],
        [t('評分', 'Score'), number(trial.score)],
        [t('失線時間', 'Time off line'), number(lostSeconds(trial), 2) + ' s · ' + t(count + ' 次', count + (count === 1 ? ' loss' : ' losses'))],
        [t('循線距離', 'Distance on line'), number(trial.metrics.onLineDistance, 2) + ' m'],
      ];
      for (const [name, value] of data) {
        const td = document.createElement('td');
        td.dataset.label = name; td.textContent = value; tr.append(td);
      }
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = t('重播', 'Replay'); button.dataset.replay = trial.index;
      button.setAttribute('aria-label', t('重播第 ' + n + ' 輪', 'Replay round ' + n));
      button.addEventListener('click', () => play(trial, false));
      action.append(button); tr.append(action); rows.append(tr);
    }
    if (champion) {
      const n = champion.index + 1;
      const scores = number(baseline.score) + ' → ' + number(champion.score);
      const losses = number(lostSeconds(baseline), 2) + ' → ' + number(lostSeconds(champion), 2);
      byId('trial-comparison').textContent = t(
        '基準 → 最佳（第 ' + n + ' 輪）　評分 ' + scores + ' 分，失線 ' + losses + ' 秒。',
        'Baseline → best (round ' + n + '). Score ' + scores + '. Time off line ' + losses + ' s.'
      );
    }
    byId('trial-bar').value = completed.length;
    byId('trial-bar').max = expected;
    updateControls();
  }

  function updateGhosts(current = null) {
    const excluded = current?.index ?? -1;
    showGhosts(completed.filter(t => t.index !== excluded), best()?.index ?? -1, excluded, current);
    setGhostVisibility(ghosts.checked);
  }

  function showGains(trial) {
    for (const key of ['p', 'i', 'd']) byId('trial-' + key).textContent = trial ? String(trial.params[key]) : '—';
  }

  function cancelPlayback() {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    player = null;
    syncPlaybackRate = null;
  }

  function cancelWork() {
    if (worker) { worker.terminate(); worker = null; }
    cancelPlayback();
    pending = [];
    auto = false;
    allReceived = false;
  }

  function stopNow() {
    if (!auto && !player) return;
    cancelWork();
    const n = completed.length;
    showMessage(progress, '已停止 · 已展示 ' + n + ' 輪', 'Stopped · ' + n + (n === 1 ? ' round shown' : ' rounds shown'));
    if (n) showMessage(note, '可重播已完成的輪次，或重新開始試跑。', 'Replay a completed round or start a new set of trials.');
    else showMessage(note, '再次開始即可由基準輪重新試跑。', 'Start again to run the baseline.');
    showStage('paused', '試跑已停止', 'Trials stopped');
    updateGhosts();
    updateControls();
  }

  function resetSession() {
    cancelWork();
    completed = [];
    batchInputs = null;
    appliedIndex = null;
    expected = ROUNDS;
    showGains(null);
    showMessage(progress, '準備試跑 · 共 ' + expected + ' 輪', 'Ready · ' + expected + ' rounds');
    const speed = getInputs().speed;
    showSetup();
    if (speed > 0) showMessage(note, '首輪以零增益作基準，之後逐輪比較。', 'Round 1 uses zero PID gains as the baseline.');
    else showMessage(note, '速度指令目前為 0。請在手動模式調高速度指令，再開始試跑。', 'Set a speed command above zero in manual mode to start the trials.');
    updateHistory();
    if (active) {
      resetTrail();
      updateGhosts();
      renderOrigin();
      showStage('ready', '試跑就緒', 'Trials ready');
    }
  }

  function finish() {
    auto = false;
    const champion = best();
    showMessage(progress, '已完成 ' + completed.length + ' 輪', completed.length + ' rounds complete');
    if (champion?.index === 0) {
      showMessage(note, '本次試跑以基準輪得分最高。可重播各輪，比較其循線走勢。',
        'No round beat the baseline. Replay the rounds to compare their paths.');
    } else {
      const n = champion.index + 1;
      showMessage(note, '第 ' + n + ' 輪得分最高。可重播比較，再選擇是否套用。',
        'Round ' + n + ' has the highest score. Replay it before applying its gains.');
    }
    showStage('ready', '試跑完成', 'Trials complete');
    updateGhosts();
    renderFrame(completed.at(-1).frames.at(-1));
    updateControls();
  }

  function next() {
    if (!auto || player) return;
    if (pending.length) play(pending.shift(), true);
    else if (allReceived) finish();
    else {
      const n = completed.length + 1;
      showMessage(progress, '正在計算第 ' + n + ' 輪…', 'Simulating round ' + n + '…');
      showStage('running', '計算試跑中', 'Simulating');
    }
  }

  function play(trial, partOfBatch) {
    if (!active || player || !trial.frames.length) return;
    const frames = trial.frames;
    const last = frames.length - 1;
    let position = 0;
    let clock = frames[0].time;
    let previous = null;
    let playbackRate = Number(rate.value);
    player = trial;
    resetTrail();
    updateGhosts(trial);
    showGains(trial);
    renderFrame(frames[0]);
    const numberLabel = (trial.index + 1) + ' / ' + expected;
    showMessage(progress, (partOfBatch ? '展示第 ' : '重播第 ') + numberLabel + ' 輪' + (trial.index === 0 ? ' · 基準' : ''),
      (partOfBatch ? 'Showing round ' : 'Replaying round ') + numberLabel + (trial.index === 0 ? ' · Baseline' : ''));
    if (trial.index === 0) showMessage(note, '基準輪 P、I、D 都係 0。左右摩打一直收到相同指令，即使已開啟搜線，架車都會直行。',
      'The baseline runs open loop. With P, I and D at zero, both motors receive equal commands even when search is enabled.');
    else showMessage(note, '比較現時行車軌跡與已完成輪次的路線。', 'Compare this path with the traces from earlier rounds.');
    showStage('running', '重播第 ' + (trial.index + 1) + ' 輪', 'Replaying round ' + (trial.index + 1));
    updateControls();
    function advanceClock(now) {
      if (previous !== null) clock += Math.min(Math.max(now - previous, 0) / 1000, .25) * playbackRate;
      previous = now;
    }
    // A change between two animation frames takes effect at the UI event.
    // Both the telemetry panel and the renderer consume the same recorded tick.
    syncPlaybackRate = () => {
      advanceClock(performance.now());
      playbackRate = Number(rate.value);
    };
    function tick(now) {
      if (!active || player !== trial) return;
      advanceClock(now);
      let candidate = position;
      while (candidate < last && frames[candidate + 1].time <= clock + 1e-6) candidate++;
      if (candidate !== position) { position = candidate; renderFrame(frames[position]); }
      if (position < last) {
        animation = requestAnimationFrame(tick);
        return;
      }
      player = null; animation = 0; syncPlaybackRate = null;
      if (partOfBatch) {
        completed.push(trial);
        updateHistory();
        next();
      } else {
        const n = trial.index + 1;
        showMessage(progress, '第 ' + n + ' 輪重播完畢', 'Round ' + n + ' replay complete');
        showMessage(note, '本輪評分 ' + number(trial.score) + ' 分，失線 ' + number(lostSeconds(trial)) + ' 秒。',
          'Score ' + number(trial.score) + '. Time off line ' + number(lostSeconds(trial)) + ' s.');
        showStage('ready', '重播完畢', 'Replay complete');
        updateGhosts();
        renderFrame(frames[last]);
        updateControls();
      }
    }
    animation = requestAnimationFrame(tick);
  }

  function fail(code, detail) {
    cancelWork();
    if (detail) console.error(detail);
    showMessage(progress, '試跑中斷', 'Trials interrupted');
    if (code === 'INVALID_SPEED') {
      showMessage(note, '請將基礎速度指令設為 1 至 23 嘅整數，再開始試跑。', 'Set the base speed command to a whole number from 1 to 23, then restart.');
    } else {
      showMessage(note, '未能啟動或完成物理計算，請再試一次。', 'The physics simulation could not complete. Restart the trials to try again.');
    }
    showStage('error', '試跑中斷', 'Trials interrupted');
    updateControls();
  }

  function run() {
    if (!active || auto || player || !(getInputs().speed > 0)) return;
    resetSession();
    batchInputs = getInputs();
    auto = true;
    showMessage(progress, '正在計算基準輪…', 'Simulating the baseline…');
    showMessage(note, '每輪採用同一車身、賽道、起點及速度指令。', 'Every round uses the same car, course, starting pose and speed command.');
    showStage('running', '計算試跑中', 'Simulating');
    updateControls();
    try {
      const w = new Worker(new URL('./tuning-worker.js', import.meta.url), { type: 'module' });
      worker = w;
      w.onmessage = ({ data }) => {
        if (w !== worker || !active) return;
        if (data.type === 'error') { fail(data.code, data.message); return; }
        if (data.type === 'trial') {
          expected = data.total;
          pending.push(data.trial);
        } else if (data.type === 'done') {
          allReceived = true;
          w.terminate(); worker = null;
        }
        next();
      };
      w.onerror = error => { if (w === worker) fail('TRIAL_FAILED', error.message); };
      const { course, physical, speed, recovery, sensorOrder, commandDelayMs, startOffsetMm } = batchInputs;
      w.postMessage({ course, physical, speed, recovery, sensorOrder, commandDelayMs, startOffsetMm });
    } catch (error) { fail('TRIAL_FAILED', error.message); }
  }

  start.addEventListener('click', run);
  stop.addEventListener('click', stopNow);
  reset.addEventListener('click', resetSession);
  rate.addEventListener('change', () => syncPlaybackRate?.());
  ghosts.addEventListener('change', () => setGhostVisibility(ghosts.checked));
  apply.addEventListener('click', () => {
    const champion = best();
    if (!champion || auto || player) return;
    applyGains(champion.params);
    appliedIndex = champion.index;
    const n = champion.index + 1;
    showMessage(note, '手動模式已採用第 ' + n + ' 輪的 P、I、D。',
      'Manual mode now uses the P, I and D gains from round ' + n + '.');
    updateControls();
  });
  onLanguageChange(() => {
    showSetup();
    updateHistory();
    for (const [element, copy] of currentMessages) element.textContent = t(...copy);
    if (active && stageMessage) {
      const [kind, zh, en] = stageMessage;
      setStatus(kind, t(zh, en));
    }
  });
  exportButton.addEventListener('click', () => {
    if (!completed.length) return;
    const lines = ['round,trial_horizon_s,p_gain,i_gain,d_gain,base_command_counts_per_10ms,score,loss_fraction,lost_s,rms_error,on_line_distance_m,path_progress_m,stability,best_round_so_far,sensor_order,search_enabled,loss_count,longest_loss_s,command_delay_ms,start_offset_mm'];
    for (const t of completed) {
      const m = t.metrics;
      lines.push([t.index + 1,t.horizon,t.params.p,t.params.i,t.params.d,t.params.speed,t.score,m.lossFraction,
        lostSeconds(t),m.rmsError,m.onLineDistance,m.pathProgress,m.stability,t.bestIndex + 1,
        t.params.sensorOrder,Number(t.params.recovery),m.lossCount,m.longestLoss,t.params.commandDelayMs,t.params.startOffsetMm].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'line-follower-ai-trials-' + Date.now() + '.csv';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return {
    enter() {
      active = true;
      const champion = best();
      if (champion && ['p', 'i', 'd'].some(key => getInputs().manualGains[key] !== champion.params[key])) appliedIndex = null;
      const inputs = getInputs();
      if (!completed.length || ['speed', 'sensorOrder', 'recovery', 'commandDelayMs', 'startOffsetMm'].some(key => batchInputs?.[key] !== inputs[key])) resetSession();
      else {
        resetTrail(); renderOrigin(); updateGhosts(); showGains(null); updateHistory();
        showSetup();
        showStage('ready', '試跑就緒', 'Trials ready');
      }
    },
    leave() {
      if (!active) return;
      stopNow();
      active = false;
      showGhosts([], -1, -1);
      setGhostVisibility(false);
    },
    stop: stopNow,
    invalidate() { resetSession(); },
  };
}
