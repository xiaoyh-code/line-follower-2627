// F5 classroom line follower: ESP32 Dev Module, TT motors and the eight-channel reflectance board.
// Install LineFollowerLearn8CH.zip and MotorEncoderBoard.zip from the teaching site.
// On startup open Serial Monitor at 115200 for this robot's Wi-Fi name, password and web address.
// The physical sketch retains the classroom lost-line search. The browser simulator
// bypasses that search in the special all-zero-gains demonstration.

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <esp_random.h>

#include "MotorEncoderBoard.h"
#include "LineFollowerLearn8CH.h"


// ============================================================
// WIFI SETTINGS
// ============================================================

// Choose only one network mode:
//
// NETWORK_AP  = ESP32 creates its own WiFi network.
// NETWORK_STA = ESP32 connects to the school WiFi.
enum NetworkMode {
  NETWORK_AP,
  NETWORK_STA
};

const NetworkMode networkMode =
  NETWORK_AP;

// -------- School WiFi --------
// Change these
const char* schoolSSID = "";
const char* schoolPassword = "";


// -------- ESP32 own WiFi --------
// Generated locally at boot. Each robot prints its own AP details in Serial Monitor.
char robotSSID[28];
char robotPassword[17];


// ============================================================
// WEB SERVER
// ============================================================

WebServer server(80);


// ============================================================
// MOTOR + SENSOR OBJECTS
// ============================================================

MotorEncoderBoard motor;

linefollower_8ch linefollower;


// ============================================================
// ROBOT STATE
// ============================================================

// Robot is STOPPED when powered on
bool robotRunning = false;


// ============================================================
// MOTOR SETTINGS
// ============================================================

int baseSpeed = 10;

int maxSpeed = 23;


// Current motor commands
int currentLeftSpeed = 0;
int currentRightSpeed = 0;


// ============================================================
// PID SETTINGS
// ============================================================

float Kp = 1.0;
float Ki = 0.0;
float Kd = 0.0;


float error = 0;
float lastError = 0;

float integral = 0;
float derivative = 0;

float correction = 0;


// Maximum PID steering correction
float maxCorrection = 8;


// ============================================================
// PID CONTROL TIMING
// ============================================================

// 10 ms = 100 Hz

const unsigned long CONTROL_PERIOD = 10000;

unsigned long lastControlTime = 0;

// Previous valid encoder sample for wheel-speed telemetry.
bool haveEncoderSample = false;
uint32_t encoderSampleUs = 0;
int32_t previousM3Count = 0;
int32_t previousM4Count = 0;


// ============================================================
// SENSOR WEIGHTS
//
// Classroom installation, looking forward from the robot:
//
// LEFT                              RIGHT
//
// S1   S2   S3   S4   S5   S6   S7   S8
//
// I2C address 0x5D, register 5. The library returns the raw bits.
// On the classroom I2C board black tape reads 1 and the white surface reads 0.
// state_all_ch[0] = bit 0 = Sensor 1
// state_all_ch[7] = bit 7 = Sensor 8
// 01_Digital_States prints S1 first. A binary register value prints bit 7 first.
// ============================================================

constexpr uint8_t BLACK_LINE = 1;

int sensorWeight[8] = {
  -7,  //s1
  -5,  //s2
  -3,  //s3
  -1,  //s4
  1,   //s5
  3,   // s6
  5,   //s7
  7    //s8
};


// ============================================================
// HTML PAGE
// ============================================================

const char webpage[] PROGMEM = R"rawliteral(

<!DOCTYPE html>

<html>

<head>

<meta name="viewport"
content="width=device-width, initial-scale=1">

<title>F5 Line Follower</title>


<style>

body
{
    font-family: Arial, sans-serif;

    background: #f2f4f7;

    margin: 0;

    text-align: center;
}


.container
{
    max-width: 520px;

    margin: auto;

    padding: 20px;
}


.card
{
    background: white;

    margin-top: 18px;

    padding: 20px;

    border-radius: 12px;

    box-shadow:
        0 2px 8px rgba(0,0,0,0.08);
}


h1
{
    margin-bottom: 5px;
}


.subtitle
{
    color: #666;
}


.status
{
    font-size: 24px;

    font-weight: bold;

    margin-bottom: 15px;
}


button
{
    border: none;

    border-radius: 8px;

    padding: 14px 25px;

    font-size: 18px;

    cursor: pointer;

    margin: 5px;
}


.start
{
    background: #22a447;

    color: white;
}


.stop
{
    background: #d9363e;

    color: white;
}


.update
{
    background: #1677ff;

    color: white;

    width: 100%;

    margin-top: 20px;
}


label
{
    display: block;

    text-align: left;

    margin-top: 15px;

    font-weight: bold;
}


input
{
    width: 100%;

    box-sizing: border-box;

    padding: 10px;

    margin-top: 5px;

    font-size: 18px;
}


.sensorRow
{
    display: flex;

    justify-content: space-between;

    margin-top: 15px;
}


.sensor
{
    width: 38px;

    height: 38px;

    border-radius: 6px;

    background: #ddd;

    line-height: 38px;

    font-size: 13px;

    font-weight: bold;
}


.sensor.active
{
    background: #222;

    color: white;
}


.dataRow
{
    display: flex;

    justify-content: space-between;

    padding: 7px;

    border-bottom: 1px solid #eee;
}


.running
{
    color: #22a447;
}


.stopped
{
    color: #d9363e;
}

</style>

</head>


<body>


<div class="container">


<h1>F5 Line Follower</h1>

<div class="subtitle">
PID Control Panel
</div>


<!-- ====================================================== -->
<!-- ROBOT CONTROL -->
<!-- ====================================================== -->

<div class="card">

<div class="status">

Robot:

<span
id="robotStatus"
class="stopped">

STOPPED

</span>

</div>


<button
class="start"
onclick="startRobot()">

START

</button>


<button
class="stop"
onclick="stopRobot()">

STOP

</button>

</div>


<!-- ====================================================== -->
<!-- PID SETTINGS -->
<!-- ====================================================== -->

<div class="card">

<h2>PID Settings</h2>


<label>
Kp
</label>

<input
id="kp"
type="number"
value="1.0"
step="0.01">


<label>
Ki
</label>

<input
id="ki"
type="number"
value="0"
step="0.01">


<label>
Kd
</label>

<input
id="kd"
type="number"
value="0.00"
step="0.01">


<label>
Base Speed
</label>

<input
id="baseSpeed"
type="number"
value="10"
step="1">


<button
class="update"
onclick="updatePID()">

UPDATE SETTINGS

</button>

</div>


<!-- ====================================================== -->
<!-- SENSOR DISPLAY -->
<!-- ====================================================== -->

<div class="card">

<h2>8-CH Reflectance Sensor</h2>


<div class="sensorRow">

<div class="sensor" id="s1">S1</div>
<div class="sensor" id="s2">S2</div>
<div class="sensor" id="s3">S3</div>
<div class="sensor" id="s4">S4</div>
<div class="sensor" id="s5">S5</div>
<div class="sensor" id="s6">S6</div>
<div class="sensor" id="s7">S7</div>
<div class="sensor" id="s8">S8</div>

</div>


<p>
S1 (left) to S8 (right), facing forward. Raw bit: 1 = black tape, 0 = white.
</p>

</div>


<!-- ====================================================== -->
<!-- LIVE DATA -->
<!-- ====================================================== -->

<div class="card">

<h2>Live PID Data</h2>


<div class="dataRow">

<span>Error</span>

<span id="error">
0
</span>

</div>


<div class="dataRow">

<span>Correction</span>

<span id="correction">
0
</span>

</div>


<div class="dataRow">

<span>Left Speed</span>

<span id="leftSpeed">
0
</span>

</div>


<div class="dataRow">

<span>Right Speed</span>

<span id="rightSpeed">
0
</span>

</div>


<div class="dataRow">

<span>Kp</span>

<span id="showKp">
1.0
</span>

</div>


<div class="dataRow">

<span>Ki</span>

<span id="showKi">
0
</span>

</div>


<div class="dataRow">

<span>Kd</span>

<span id="showKd">
0.00
</span>

</div>


<div class="dataRow">

<span>Base Speed</span>

<span id="showBase">
10
</span>

</div>


</div>


</div>


<script>


// ==========================================================
// START ROBOT
// ==========================================================

function startRobot()
{
    fetch("/start");
}


// ==========================================================
// STOP ROBOT
// ==========================================================

function stopRobot()
{
    fetch("/stop");
}


// ==========================================================
// UPDATE PID
// ==========================================================

function updatePID()
{
    let kp =
        document.getElementById("kp").value;

    let ki =
        document.getElementById("ki").value;

    let kd =
        document.getElementById("kd").value;

    let base =
        document.getElementById("baseSpeed").value;


    fetch(
        "/setPID?kp=" + kp +
        "&ki=" + ki +
        "&kd=" + kd +
        "&base=" + base
    );
}


// ==========================================================
// LIVE DATA
// ==========================================================

function updateStatus()
{
    fetch("/status")

    .then(response => response.json())

    .then(data =>
    {

        // --------------------------------------------------
        // Robot status
        // --------------------------------------------------

        let status =
            document.getElementById(
                "robotStatus"
            );


        if (data.running)
        {
            status.innerHTML =
                "RUNNING";

            status.className =
                "running";
        }

        else
        {
            status.innerHTML =
                "STOPPED";

            status.className =
                "stopped";
        }


        // --------------------------------------------------
        // PID Data
        // --------------------------------------------------

        document.getElementById(
            "error"
        ).innerHTML =
            data.error.toFixed(2);


        document.getElementById(
            "correction"
        ).innerHTML =
            data.correction.toFixed(2);


        document.getElementById(
            "leftSpeed"
        ).innerHTML =
            data.leftSpeed;


        document.getElementById(
            "rightSpeed"
        ).innerHTML =
            data.rightSpeed;


        document.getElementById(
            "showKp"
        ).innerHTML =
            data.kp;


        document.getElementById(
            "showKi"
        ).innerHTML =
            data.ki;


        document.getElementById(
            "showKd"
        ).innerHTML =
            data.kd;


        document.getElementById(
            "showBase"
        ).innerHTML =
            data.baseSpeed;


        // --------------------------------------------------
        // Sensors
        // --------------------------------------------------

        for (let i = 0; i < data.sensors.length; i++) {
            const channel = i + 1;
            const sensor = document.getElementById("s" + channel);
            const raw = data.sensors[i];
            sensor.textContent = "S" + channel + ": " + raw;
            sensor.classList.toggle("active", raw === 1);
        }

    })

    .catch(error =>
    {
        console.log(
            "Connection error"
        );
    });
}


// Update UI every 200 ms = 5 Hz

setInterval(
    updateStatus,
    200
);


</script>


</body>

</html>

)rawliteral";


// ============================================================
// WEB: MAIN PAGE
// ============================================================

void handleRoot() {
  server.send_P(
    200,
    "text/html",
    webpage);
}


// ============================================================
// WEB: START ROBOT
// ============================================================

void handleStart() {
  integral = 0;

  derivative = 0;

  lastError = 0;

  correction = 0;


  lastControlTime =
    micros();


  haveEncoderSample = false;
  Serial.println("t_us,dt_us,line_found,line_error,prev_left,prev_right,left_target,right_target,left_measured,right_measured");

  robotRunning = true;


  server.send(
    200,
    "text/plain",
    "START");
}


// ============================================================
// WEB: STOP ROBOT
// ============================================================

void handleStop() {
  robotRunning = false;


  currentLeftSpeed = 0;

  currentRightSpeed = 0;


  // Stop motors immediately

  motor.setSpeed(
    0,
    0,
    0,
    0);


  // Reset PID

  integral = 0;

  derivative = 0;

  correction = 0;


  server.send(
    200,
    "text/plain",
    "STOP");
}


// ============================================================
// WEB: CHANGE PID SETTINGS
// ============================================================

void handleSetPID() {
  if (server.hasArg("kp")) {
    Kp =
      server.arg("kp").toFloat();
  }


  if (server.hasArg("ki")) {
    Ki =
      server.arg("ki").toFloat();
  }


  if (server.hasArg("kd")) {
    Kd =
      server.arg("kd").toFloat();
  }


  if (server.hasArg("base")) {
    baseSpeed =
      server.arg("base").toInt();


    baseSpeed =
      constrain(
        baseSpeed,
        0,
        maxSpeed);
  }


  // Reset integral after changing PID
  integral = 0;


  server.send(
    200,
    "text/plain",
    "PID UPDATED");
}


// ============================================================
// WEB: LIVE STATUS
// ============================================================

void handleStatus() {
  // The control loop samples while driving. Also allow table-top checks with
  // the motors stopped: move black tape under one probe and watch it read 1.
  if (!robotRunning) {
    detect_state_all_channel_IIC(&linefollower);
  }
  String json = "{";


  // Robot state

  json += "\"running\":";

  if (robotRunning) {
    json += "true";
  }

  else {
    json += "false";
  }


  // PID data

  json += ",\"error\":";
  json += String(error);


  json += ",\"correction\":";
  json += String(correction);


  json += ",\"leftSpeed\":";
  json += String(currentLeftSpeed);


  json += ",\"rightSpeed\":";
  json += String(currentRightSpeed);


  json += ",\"kp\":";
  json += String(Kp);


  json += ",\"ki\":";
  json += String(Ki);


  json += ",\"kd\":";
  json += String(Kd);


  json += ",\"baseSpeed\":";
  json += String(baseSpeed);


  // Raw bits, ordered S1 to S8 exactly as in the library's 01_Digital_States.

  json += ",\"sensors\":[";


  for (int i = 0; i < 8; i++) {
    json +=
      String(
        linefollower.state_all_ch[i]);


    if (i < 7) {
      json += ",";
    }
  }


  json += "]";


  json += "}";


  server.send(
    200,
    "application/json",
    json);
}


// ============================================================
// WIFI + WEB SERVER
// ============================================================

void setupWiFi() {
  if (networkMode == NETWORK_AP) {
    // ESP32 creates its own WiFi network.
    // Connect the computer to robotSSID, then open
    // http://192.168.4.1
    WiFi.mode(
      WIFI_AP);

    const uint32_t robotId = (ESP.getEfuseMac() >> 24) & 0xFFFFFF;
    snprintf(robotSSID, sizeof(robotSSID), "LineFollower-%06lX", static_cast<unsigned long>(robotId));
    snprintf(robotPassword, sizeof(robotPassword), "%08lX%08lX",
             static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));

    WiFi.softAP(
      robotSSID,
      robotPassword);
  }

  else {
    // ESP32 joins the school WiFi.
    // DHCP automatically assigns its IP address.
    WiFi.mode(
      WIFI_STA);

    WiFi.begin(
      schoolSSID,
      schoolPassword);

    // Try connecting for 15 seconds.
    unsigned long startTime =
      millis();

    while (
      WiFi.status() != WL_CONNECTED
      && millis() - startTime < 15000) {
      delay(250);
    }

    // If supported by the network, this also allows:
    // http://linefollower.local
    if (
      WiFi.status()
      == WL_CONNECTED) {
      MDNS.begin(
        "linefollower");
    }
  }


  // ========================================================
  // WEB ROUTES
  // ========================================================

  server.on(
    "/",
    handleRoot);


  server.on(
    "/start",
    handleStart);


  server.on(
    "/stop",
    handleStop);


  server.on(
    "/setPID",
    handleSetPID);


  server.on(
    "/status",
    handleStatus);


  server.begin();
}


// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(
    115200);


  // ========================================================
  // MOTOR DRIVER
  //
  // I2C BUS 0
  //
  // SDA = GPIO21
  // SCL = GPIO22
  // ========================================================

  motor.begin(
    21,
    22,
    0,
    MotorEncoderBoard::MOTOR_TYPE_TT);


  // ========================================================
  // 8 CHANNEL REFLECTANCE SENSOR
  //
  // Shared I2C BUS 0
  //
  // SDA = GPIO21
  // SCL = GPIO22
  // ========================================================

  LineFollowerLearn8CH_IIC_init(
    21,
    22,
    0);


  // ========================================================
  // STOP MOTORS
  // ========================================================

  motor.setSpeed(
    0,
    0,
    0,
    0);


  // ========================================================
  // WIFI
  // ========================================================

  setupWiFi();


  // ========================================================
  // SHOW CONNECTION INFORMATION
  // ========================================================

  Serial.println();
  Serial.println(
    "==============================");

  Serial.println(
    "F5 Line Follower");

  Serial.println(
    "==============================");


  if (networkMode == NETWORK_AP) {
    Serial.println(
      "Network mode: ESP32 Access Point");

    Serial.print(
      "Connect to WiFi: ");

    Serial.println(
      robotSSID);
    Serial.print("Wi-Fi password: ");
    Serial.println(robotPassword);

    Serial.print(
      "Open: http://");

    Serial.println(
      WiFi.softAPIP());
  }

  else {
    Serial.println(
      "Network mode: School WiFi Station");

    if (
      WiFi.status()
      == WL_CONNECTED) {
      Serial.println(
        "School WiFi connected");

      Serial.print(
        "Open: http://");

      Serial.println(
        WiFi.localIP());

      Serial.println(
        "Or try: http://linefollower.local");
    }

    else {
      Serial.println(
        "School WiFi connection failed");

      Serial.println(
        "Check the SSID/password, or select NETWORK_AP");
    }
  }


  Serial.println(
    "==============================");


  delay(500);


  lastControlTime =
    micros();
}


// ============================================================
// READ LINE POSITION
// ============================================================

float getLineError(
  bool& lineFound) {
  // Read all 8 digital sensor states

  detect_state_all_channel_IIC(
    &linefollower);


  float totalPosition = 0;

  int activeSensors = 0;


  // Calculate weighted average

  for (int i = 0; i < 8; i++) {
    if (linefollower.state_all_ch[i] == BLACK_LINE) {
      totalPosition +=
        sensorWeight[i];


      activeSensors++;
    }
  }


  // ========================================================
  // NO LINE
  // ========================================================

  if (activeSensors == 0) {
    lineFound = false;


    return lastError;
  }


  lineFound = true;


  // ========================================================
  // LINE POSITION
  // ========================================================

  float position =
    totalPosition / activeSensors;


  return position;
}


// ============================================================
// PID CALCULATION
// ============================================================

float calculatePID(
  float currentError,
  float dt) {
  // ========================================================
  // P
  // ========================================================

  float proportional =
    currentError;


  // ========================================================
  // I
  // ========================================================

  integral +=
    currentError * dt;


  // Prevent integral wind-up

  integral =
    constrain(
      integral,
      -20.0,
      20.0);


  // ========================================================
  // D
  // ========================================================

  derivative =
    (currentError
     - lastError)
    / dt;


  // ========================================================
  // PID
  // ========================================================

  float output =
    Kp * proportional
    + Ki * integral
    + Kd * derivative;


  output =
    constrain(
      output,
      -maxCorrection,
      maxCorrection);


  lastError =
    currentError;


  return output;
}


// ============================================================
// DRIVE ROBOT
// ============================================================

void driveRobot(
  int leftSpeed,
  int rightSpeed) {
  // Limit speed

  leftSpeed =
    constrain(
      leftSpeed,
      0,
      maxSpeed);


  rightSpeed =
    constrain(
      rightSpeed,
      0,
      maxSpeed);


  // Save for webpage

  currentLeftSpeed =
    leftSpeed;


  currentRightSpeed =
    rightSpeed;


  // ========================================================
  // Your current motor connection
  //
  // M1 = unused
  // M2 = unused
  // M3 = LEFT motor
  // M4 = RIGHT motor
  //
  // Left motor requires negative direction
  // Right motor requires positive direction
  // ========================================================

  motor.setSpeed(
    0,
    0,
    -leftSpeed,
    rightSpeed);
}


// ============================================================
// LOST LINE SEARCH
// ============================================================

void searchForLine() {
  // Last detected line was left

  if (lastError < 0) {
    driveRobot(
      3,
      maxSpeed);
  }


  // Last detected line was right

  else if (lastError > 0) {
    driveRobot(
      maxSpeed,
      3);
  }


  // Unknown

  else {
    driveRobot(
      baseSpeed,
      baseSpeed);
  }
}


// ============================================================
// MAIN LOOP
// ============================================================

void loop() {
  // ========================================================
  // WEB SERVER
  // ========================================================

  server.handleClient();


  // ========================================================
  // ROBOT STOPPED
  // ========================================================

  if (!robotRunning) {
    return;
  }


  // ========================================================
  // PID CONTROL TIMING
  // ========================================================

  unsigned long currentTime =
    micros();


  unsigned long elapsedTime =
    currentTime
    - lastControlTime;


  // Run PID every 10 ms

  if (
    elapsedTime
    < CONTROL_PERIOD) {
    return;
  }


  // Convert microseconds to seconds

  float dt =
    elapsedTime
    / 1000000.0;


  lastControlTime =
    currentTime;


  // ========================================================
  // READ REFLECTANCE SENSOR
  // ========================================================

  bool lineFound;


  error =
    getLineError(
      lineFound);

  // Measure the interval driven by the preceding command.
  const int previousLeftTarget = currentLeftSpeed;
  const int previousRightTarget = currentRightSpeed;
  int32_t counts[4];
  const bool encoderOk = motor.readEncoders(counts);
  const uint32_t sampleUs = micros();
  const uint32_t sampleDtUs = sampleUs - encoderSampleUs;
  float measuredLeft = NAN;
  float measuredRight = NAN;

  if (encoderOk) {
    if (haveEncoderSample && sampleDtUs != 0) {
      // Unsigned subtraction keeps the delta valid across a counter wrap.
      const int32_t deltaM3 = static_cast<int32_t>(
        static_cast<uint32_t>(counts[2]) - static_cast<uint32_t>(previousM3Count));
      const int32_t deltaM4 = static_cast<int32_t>(
        static_cast<uint32_t>(counts[3]) - static_cast<uint32_t>(previousM4Count));
      const float scale = 10000.0f / sampleDtUs;
      measuredLeft = -static_cast<float>(deltaM3) * scale;
      measuredRight = static_cast<float>(deltaM4) * scale;
    }
    previousM3Count = counts[2];
    previousM4Count = counts[3];
  }

  const bool speedValid = encoderOk && haveEncoderSample && sampleDtUs != 0;
  haveEncoderSample = encoderOk;
  encoderSampleUs = sampleUs;

  if (!lineFound) {
    integral = 0;
    searchForLine();
  } else {
    correction = calculatePID(error, dt);
    driveRobot(baseSpeed + correction, baseSpeed - correction);
  }

  // Skip a row if the serial buffer is full, so logging does not delay steering.
  char row[120];
  const int length = snprintf(
    row, sizeof(row), "%lu,%lu,%d,%.2f,%d,%d,%d,%d,%.2f,%.2f\n",
    static_cast<unsigned long>(sampleUs),
    static_cast<unsigned long>(speedValid ? sampleDtUs : 0),
    lineFound, error, previousLeftTarget, previousRightTarget,
    currentLeftSpeed, currentRightSpeed, measuredLeft, measuredRight);
  if (length > 0 && length < sizeof(row) && Serial.availableForWrite() >= length) {
    Serial.write(reinterpret_cast<const uint8_t*>(row), length);
  }
}
