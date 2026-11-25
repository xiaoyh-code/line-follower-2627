#include <LineFollowerLearn8CH.h>
linefollower_8ch linefollower{}; // Define the legacy extern declared by the header.

void setup() {
  Serial.begin(115200);
  LineFollowerLearn8CH_IIC_init(21, 22, 0);
}

void loop() {
  detect_state_all_channel_IIC(&linefollower); // Refresh BEFORE printing.
  for (int i = 0; i < 8; ++i) {
    Serial.print(linefollower.state_all_ch[i]);
    Serial.print(' ');
  }
  Serial.println();
  delay(200);
}
