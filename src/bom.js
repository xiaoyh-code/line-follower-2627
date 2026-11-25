import './bom.css';
import { registerTranslations } from './i18n.js';

function label(zh, en) {
  registerTranslations({ [zh]: en });
  return zh;
}

const worksheet = '/worksheets/hardware/';
const hiwonder = 'https://www.hiwonder.com/products/';
const irManual = 'https://docs.hiwonder.com/projects/8-ch-Line-Follower/en/latest/docs/';

const hardware = [
  {
    part: label('Hiwonder 八路 RGB 循線板', 'Hiwonder eight-channel RGB line sensor'),
    quantity: label('1 塊', '1 board'),
    spec: label('揀 Standard Version，5 V、I²C、闊 90 mm。工作紙相中嘅板印有「RGB LineFollower 8CH V1.0」，闊度同 Fusion 車模吻合。', 'Select the 5 V, 90 mm Standard Version with I²C. The worksheet photo shows “RGB LineFollower 8CH V1.0”. Its width matches the Fusion model.'),
    links: [
      [hiwonder + '8-channel', label('Hiwonder RGB 標準版', 'Hiwonder RGB Standard Version')],
      [worksheet + 'rgb-line-sensor-labelled.webp', label('課堂探頭實物圖', 'Classroom sensor photo')],
    ],
  },
  {
    part: label('Hiwonder 四路編碼摩打驅動板', 'Hiwonder four-channel encoder motor driver'),
    quantity: label('1 塊', '1 board'),
    spec: label('課堂用 Encoder Motor Module V1.4。Main 程式用 M3 接左摩打，M4 接右摩打。', 'The classroom board is marked Encoder Motor Module V1.4. The main sketch drives the left motor on M3 and the right motor on M4.'),
    links: [
      [hiwonder + '4-channel-encoder-motor-driver', label('Hiwonder 驅動板', 'Hiwonder motor driver')],
      [worksheet + 'esp32-m3-m4-motor-wiring.webp', label('課堂 M3／M4 接線圖', 'Classroom M3/M4 wiring')],
    ],
  },
  {
    part: label('Hiwonder TT 霍爾編碼減速摩打', 'Hiwonder TT gear motor with Hall encoder'),
    quantity: label('2 隻', '2 motors'),
    spec: label('左右輪各用一隻。塑膠輸出軸、42:1 減速、空載轉速 150 rpm。官網可揀 Set of 2。', 'One motor per drive wheel. Choose the plastic shaft with 42:1 reduction and 150 rpm no-load speed. Hiwonder offers a set of two.'),
    links: [[hiwonder + 'tt-motor-plastic', label('Hiwonder TT 摩打', 'Hiwonder TT motor')]],
  },
  {
    part: label('ESP32 開發板及擴展板', 'ESP32 development board and expansion board'),
    quantity: label('各 1 塊', '1 of each'),
    spec: label('品牌不限。揀經典 ESP32，例如 ESP32-WROOM-32E，配合針數同闊度吻合嘅擴展板。課堂程式用 GPIO21 做 SDA，GPIO22 做 SCL。', 'Any brand of classic ESP32 board, such as one with an ESP32-WROOM-32E module. Match the expansion board to its pin count and width. The classroom sketch uses GPIO21 for SDA and GPIO22 for SCL.'),
    links: [['https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html', label('Espressif 開發板及腳位圖', 'Espressif board and pinout')]],
  },
  {
    part: label('左右驅動輪', 'Drive wheels'),
    quantity: label('2 個車輪', '2 wheels'),
    spec: label('品牌不限，輪轂要配合 TT 輸出軸。Fusion 車輪直徑約 68 mm、闊約 26.5 mm。Hiwonder 參考款直徑亦係 68 mm，輪闊 21 mm。', 'Any brand with a hub that fits the TT shaft. The Fusion wheels measure about 68 mm in diameter and 26.5 mm in width. The Hiwonder example has the same diameter and is 21 mm wide.'),
    links: [[hiwonder + 'silicone-wheel-compatible-with-tt-motor', label('Hiwonder TT 車輪', 'Hiwonder TT wheels')]],
  },
  {
    part: label('牛眼萬向輪', 'Ball caster'),
    quantity: label('1 個萬向輪', '1 caster'),
    spec: label('按底板螺絲孔距同安裝高度揀，品牌不限。萬向輪高度會影響車身傾斜同探頭離地距離。', 'Choose a caster that matches the chassis hole spacing and mounting height. Any brand will do. Caster height affects chassis tilt and the gap between the probes and the track.'),
    links: [['https://www.pololu.com/category/45/pololu-ball-casters', label('萬向輪高度及孔距對照', 'Caster heights and hole spacing')]],
  },
  {
    part: label('雙電芯電源模組及 14500 鋰電池', 'Power module and 14500 Li-ion cells'),
    quantity: label('1 塊模組、2 粒電池', '1 module, 2 cells'),
    spec: label('工作紙用兩粒 3.7 V 14500 串聯。標稱 7.4 V 嘅一路供摩打驅動板，5 V 輸出供 ESP32 擴展板及 RGB 循線板。模組貨號待核實。', 'The worksheet uses two 3.7 V 14500 cells in series. The nominal 7.4 V branch powers the motor driver. The 5 V output supplies the ESP32 shield and RGB sensor. The module part number is still unconfirmed.'),
    links: [[worksheet + 'battery-module.webp', label('課堂電源模組實物圖', 'Classroom power module photo')]],
  },
  {
    part: label('摩打線、I²C 線及電源線', 'Motor, I²C and power leads'),
    quantity: label('1 套接線', '1 wiring set'),
    spec: label('兩條六芯 TT 編碼摩打線或轉接線，每個摩打一條。另備循線板及驅動板所需嘅 I²C 接線、電源線，同埋一條配合 ESP32 嘅 USB 數據線。', 'Use one six-wire TT encoder lead or adapter per motor, two in total. Include I²C leads for the sensor and driver, power leads and a USB data cable that fits the ESP32 board.'),
    links: [[worksheet + 'f5-shared-i2c.webp', label('課堂共用 I²C 接線圖', 'Classroom shared I²C wiring')]],
  },
];

const chassis = [
  [label('3 mm 底板及上板', '3 mm lower and upper chassis plates'), label('各 1 塊', '1 of each')],
  [label('摩打固定架及輪轂連接件', 'Motor mounts and wheel hub adapters'), label('各 2 個', '2 of each')],
  [label('循線板護架', 'Line sensor guard'), label('1 個護架', '1 guard')],
  [label('車頭三角件', 'Front triangular pieces'), label('2 個三角件', '2 triangular pieces')],
  [label('M3 × 20 mm 六角隔柱', 'M3 × 20 mm hex standoffs'), label('14 支，兩支一組', '14, assembled in pairs')],
  [label('3 mm 高 M3 膠隔柱', '3 mm tall M3 plastic spacers'), label('7 個隔柱', '7 spacers')],
  [label('螺絲、螺帽及墊片', 'Screws, nuts and washers'), label('按實車點算', 'Count on the assembled car')],
];

function linkList(links) {
  return `<div class="bom-links">${links.map(([url, name]) => `<a href="${url}">${name}</a>`).join('')}</div>`;
}

export function mountBom(root) {
  label('零件清單', 'Parts list');
  root.innerHTML = `
    <h2 id="bom-title">${label('循線車零件清單', 'Line follower bill of materials')}</h2>
    <p class="bom-intro">${label('以下係一架 2627_CAR_v2 嘅用量，根據 Fusion 車模、F5 工作紙同課堂程式整理。', 'Quantities are for one 2627_CAR_v2, based on the Fusion assembly, F5 worksheet and classroom sketch.')}</p>
    <h3>${label('控制、傳動及供電', 'Control, drive and power')}</h3>
    <dl class="bom-hardware">
      ${hardware.map(({part, quantity, spec, links}) => `<div class="bom-row">
        <dt>${part}</dt><dd class="bom-qty">${quantity}</dd>
        <dd class="bom-spec"><p>${spec}</p>${linkList(links)}</dd>
      </div>`).join('')}
    </dl>
    <div class="bom-revision">
      <h4>${label('訂購八路板前，核對通訊版本', 'Check the sensor protocol before ordering')}</h4>
      <p>${label('課堂 Library 用 I²C 位址 0x5D、暫存器 5 讀取八路狀態。Hiwonder 公開呢組數值嘅手冊對應 107 mm 紅外線板。工作紙同 Fusion 指向 90 mm RGB 標準版，該產品頁未列暫存器表。大批訂購前，請供應商確認該批 RGB 板支援 0x5D 同暫存器 5。', 'The classroom library reads all eight probes from I²C address 0x5D, register 5. Hiwonder documents that protocol for its 107 mm infrared board. The worksheet and CAD point to the 90 mm RGB Standard Version, whose listing omits the register map. Before a class order, confirm that the RGB boards supplied support address 0x5D and register 5.')}</p>
      ${linkList([
        [irManual + '2.Quick_Start.html', label('Hiwonder 暫存器表', 'Hiwonder register map')],
        [irManual + '1.8-chLine_Follower_Introduction.html', label('手冊對應嘅板尺寸', 'Board dimensions in the manual')],
      ])}
    </div>
    <h3>${label('Fusion 車架及安裝零件', 'Fusion chassis and mounting hardware')}</h3>
    <dl class="bom-chassis">${chassis.map(([part, quantity]) => `<div><dt>${part}</dt><dd>${quantity}</dd></div>`).join('')}</dl>
    <p>${label('Fusion 車模另有 3 塊 FC51 同 2 塊側邊窄身感測模組。課堂 PID 程式用中央八路板讀線。', 'The Fusion assembly also includes three FC51 modules and two narrow side sensor modules. The classroom PID sketch reads the central eight-channel board.')}</p>
    <a class="bom-drawing" href="/downloads/2627_CAR_v2-STEP.zip" download>${label('下載 Fusion 車架原圖（STEP · ZIP）', 'Download the Fusion assembly (STEP in ZIP)')}</a>
  `;
}
