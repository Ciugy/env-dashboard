import json
import sqlite3
import serial
import time
from datetime import datetime
import requests

# RTC IMPORTS
from smbus2 import SMBus

RTC_ADDR = 0x68
bus = SMBus(1)

def bcd_to_dec(b):
    return (b // 16) * 10 + (b % 16)

def rtc_now():
    """Read timestamp from DS3231 RTC using SMBus."""
    data = bus.read_i2c_block_data(RTC_ADDR, 0x00, 7)

    sec = bcd_to_dec(data[0] & 0x7F)
    minute = bcd_to_dec(data[1])
    hour = bcd_to_dec(data[2] & 0x3F)
    day = bcd_to_dec(data[4])
    month = bcd_to_dec(data[5] & 0x1F)
    year = 2000 + bcd_to_dec(data[6])

    return f"{year}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:{sec:02d}"


SERIAL_PORT = "/dev/ttyACM0"
BAUD_RATE = 115200

CONTROL_URL = "http://localhost:3000/api/control"
DB_PATH = "./src/app/api/data/sensor_data.db"

POLL_INTERVAL = 1.0
SENSOR_INTERVAL = 0.05


# LIVE TERMINAL STATUS OUTPUT
def print_status(override_text, actuator_text, sensor_text):
    print("\033[3F", end="")
    print("\r\033[K" + override_text)
    print("\r\033[K" + actuator_text)
    print("\r\033[K" + sensor_text)


# DATABASE SETUP
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS sensor_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    bme_temp REAL,
    bme_press REAL,
    bme_gas REAL,
    scd_co2 INTEGER,
    scd_hum REAL
)
""")
conn.commit()

# SERIAL SETUP
ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
time.sleep(2)
print("Serial ready")

# LATEST SENSOR VALUES
latest_temp = None
latest_hum = None
latest_press = None
latest_gas = None
latest_co2 = None


# BACKEND UPDATE
def update_backend(**kwargs):
    payload = {k: v for k, v in kwargs.items() if v is not None}
    if not payload:
        return
    try:
        requests.post(CONTROL_URL, json=payload, timeout=1)
    except:
        pass


# HANDLE ACTUATOR COMMANDS FROM ARDUINO
def handle_override_command(cmd):
    if cmd == "H":
        update_backend(heater=True)
    elif cmd == "h":
        update_backend(heater=False)
    elif cmd == "F":
        update_backend(cooling_fan=100)
    elif cmd == "f":
        update_backend(cooling_fan=0)


# ACTUATOR LOGIC 
def send_actuator_commands():
    global latest_temp, latest_hum

    # SENSOR VALIDATION 
    if latest_temp is None or latest_hum is None:
        return

    # GET BACKEND STATE 
    try:
        state = requests.get(CONTROL_URL, timeout=1).json()
    except:
        return

    mode = state.get("mode")
    setpoint = state.get("setpoint")
    override_mode = state.get("overrideMode", False)
    override_sp = state.get("overrideSetpoint")
    heater_on = state.get("heater", False)
    fan_pwm = state.get("cooling_fan", 0)
    humidifier_on = state.get("humidifier", False)

    current_temp = latest_temp
    current_hum = latest_hum
    lag = 0.3

    #TERMINAL SENSOR TEXT
    sensor_text = (
        f"Temp: {latest_temp:.1f}C | "
        f"Hum: {latest_hum:.0f}% | "
        f"CO2: {latest_co2}ppm | "
        f"Press: {latest_press:.0f}hPa"
    )

    # OVERRIDE MODE (PHYSICAL BUTTONS)
    if override_mode:
        sp = override_sp if override_sp is not None else setpoint

        if sp is not None:
            if current_temp > sp + lag:
                mode = "COOL"
            elif current_temp < sp - lag:
                mode = "HEAT"
            else:
                mode = "OFF"

        update_backend(
            mode=mode,
            heater=heater_on,
            cooling_fan=fan_pwm,
            humidifier=humidifier_on,
            overrideMode=True,
            overrideSetpoint=sp
        )

        override_text = f"Override: True (Setpoint: {sp})"
        actuator_text = f"Heater: {heater_on} | Fan: {fan_pwm}% | Humidifier: {humidifier_on}"
        print_status(override_text, actuator_text, sensor_text)
        return

    # NORMAL MODE — OVERRIDE SETPOINT TAKES PRIORITY
    if override_sp is not None:
        setpoint = override_sp

    if setpoint is None:
        return


    # OFF MODE — AUTO TRIGGER
    if mode == "OFF":
        if current_temp < setpoint - lag:
            mode = "HEAT"
        elif current_temp > setpoint + lag:
            mode = "COOL"
        else:
            # Stay OFF
            update_backend(mode="OFF", heater=False, cooling_fan=0, humidifier=False)
            override_text = f"Override: False (Setpoint: {setpoint})"
            actuator_text = "Heater: False | Fan: 0% | Humidifier: False"
            print_status(override_text, actuator_text, sensor_text)
            return

    #  HEAT MODE
    if mode == "HEAT":
        heater_on = current_temp < setpoint - lag
        humidifier_on = current_hum < 15 or (humidifier_on and current_hum < 25)

        update_backend(
            mode="HEAT",
            heater=heater_on,
            cooling_fan=fan_pwm,
            humidifier=humidifier_on
        )

        override_text = f"Override: False (Setpoint: {setpoint})"
        actuator_text = f"Heater: {heater_on} | Fan: {fan_pwm}% | Humidifier: {humidifier_on}"
        print_status(override_text, actuator_text, sensor_text)
        return

    # COOL MODE
    if mode == "COOL":
        heater_on = False
        update_backend(
            mode="COOL",
            heater=False,
            cooling_fan=fan_pwm,
            humidifier=humidifier_on
        )

        override_text = f"Override: False (Setpoint: {setpoint})"
        actuator_text = f"Heater: False | Fan: {fan_pwm}% | Humidifier: {humidifier_on}"
        print_status(override_text, actuator_text, sensor_text)
        return


    # AUTO MODE
    if mode == "AUTO":
        diff = current_temp - setpoint

        if diff > 0.5:
            heater_on = False
            fan_pwm = min(max(int((diff / 3.0) * 100), 20), 100)
        elif diff < -0.5:
            heater_on = True
            fan_pwm = 30
        else:
            heater_on = False

        humidifier_on = current_hum < 15 or (humidifier_on and current_hum < 25)

        update_backend(
            mode="AUTO",
            heater=heater_on,
            cooling_fan=fan_pwm,
            humidifier=humidifier_on
        )

        override_text = f"Override: False (Setpoint: {setpoint})"
        actuator_text = f"Heater: {heater_on} | Fan: {fan_pwm}% | Humidifier: {humidifier_on}"
        print_status(override_text, actuator_text, sensor_text)
        return



print("Listening for sensor data...")
print("\n\n\n\n")

last_actuator_poll = time.time()

while True:
    try:
        line = ser.readline().decode(errors="ignore").strip()
    except Exception as e:
        print("Serial error:", e)
        time.sleep(1)
        continue

    if line in ["H", "h", "F", "f"]:
        handle_override_command(line)
        continue

    if line:
        try:
            data = json.loads(line)
        except:
            data = None

        if data:
            ts = rtc_now()

            latest_temp = data.get("bme_temp", latest_temp)
            latest_press = data.get("bme_press", latest_press)
            latest_gas = data.get("bme_gas", latest_gas)
            latest_co2 = data.get("scd_co2", latest_co2)
            latest_hum = data.get("scd_hum", latest_hum)

            cursor.execute("""
                INSERT INTO sensor_data (
                    timestamp, bme_temp, bme_press, bme_gas,
                    scd_co2, scd_hum
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                ts,
                data.get("bme_temp"),
                data.get("bme_press"),
                data.get("bme_gas"),
                data.get("scd_co2"),
                data.get("scd_hum")
            ))
            conn.commit()

            print("Data:", ts, data)

    if time.time() - last_actuator_poll >= POLL_INTERVAL:
        send_actuator_commands()
        last_actuator_poll = time.time()

    time.sleep(SENSOR_INTERVAL)
    
    
    

