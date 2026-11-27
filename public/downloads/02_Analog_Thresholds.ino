#include <LineFollowerLearn8CH.h>
linefollower_8ch linefollower{};
void setup() {
  Serial.begin(115200);
  LineFollowerLearn8CH_IIC_init(21, 22, 0);
}
void loop() {
  get_AnalogVoltage_all_channel_IIC(&linefollower);
  get_ThresholdValue_all_channel_IIC(&linefollower);
  for (int i = 0; i < 8; ++i) {
    Serial.print("S"); Serial.print(i + 1); Serial.print(": ");
    Serial.print(linefollower.AnalogVoltage_all_ch[i]); Serial.print(" / ");
    Serial.print(linefollower.ThresholdVoltage_all_ch[i]); Serial.print("  ");
  }
  Serial.println();
  delay(500);
}
