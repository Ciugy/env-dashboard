import sqlite3
import serial
import time
import json
from datetime import datetime
import requests

SERIAL_PORT = "/dev/ttyACM0"
BAUD_RATE = 115200

CONTROL_URL = "http://localhost:3000/api/control"
DB_PATH = "./src/app/api/data/sensor_data.db"

POLL_INTERVAL = 0.10
SENSOR_INTERVAL = 0.05

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

# SERIAL SETUP (still needed for sensor input)
ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
time.sleep(2)
print("Serial ready")

def parse_line(line: str):
    parts = [p.strip() for p in line.split(",")]
    data = {}
    for p in parts:
        if ":" in p:
            key, value = p.split(":", 1)
            key = key.strip().lower()
            value = value.strip()
            try:
                value = float(value) if "." in value else int(value)
            except:
                continue
            data[key] = value
    return data

def send_actuator_commands():
    try:
        res = requests.get(CONTROL_URL, timeout=1)
        state = res.json()
    except:
        return

    mode = state.get("mode")
    setpoint = state.get("setpoint")

    # Read latest temperature + humidity
    cursor.execute("SELECT bme_temp, scd_hum FROM sensor_data ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    if not row:
        return

    current_temp, current_hum = row
    hysteresis = 0.3

    # OVERRIDE MODE
    if state.get("overrideMode") and state.get("overrideSetpoint") is not None:
        setpoint = state["overrideSetpoint"]

    # Default actuator states
    heater_on = False
    fan_pwm = 0
    humidifier_on = False

    # OFF MODE
    if mode == "OFF":
        update_backend(heater=False, fan=0, humidifier=False)
        return

    # HEAT MODE
    if mode == "HEAT":
        # Heater logic
        if current_temp < setpoint - hysteresis:
            heater_on = True
        elif current_temp > setpoint + hysteresis:
            heater_on = False

        # Cooling fan logic (PWM)
        if current_temp > setpoint + 1:
            diff = current_temp - setpoint
            fan_pwm = min(int(diff * 50), 255)  # scale: 1°C = 50 PWM
        else:
            fan_pwm = 0

        # Humidifier logic (simple ON/OFF)
        if current_hum < 40:  # threshold example
            humidifier_on = True
        elif current_hum > 45:
            humidifier_on = False

    update_backend(heater=heater_on, fan=fan_pwm, humidifier=humidifier_on)

def update_backend(heater: bool, fan: int, humidifier: bool):
    try:
        requests.post(CONTROL_URL, json={
            "heater": heater,
            "fan": fan,
            "humidifier": humidifier
        }, timeout=1)
    except:
        pass

print("Listening for sensor data...")

last_actuator_poll = time.time()

while True:
    try:
        line = ser.readline().decode(errors="ignore").strip()
    except Exception as e:
        print("Serial error:", e)
        time.sleep(1)
        continue

    if line:
        data = parse_line(line)
        if data:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

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

    if time.time() - last_actuator_poll >= POLL_INTERVAL:
        send_actuator_commands()
        last_actuator_poll = time.time()

    time.sleep(SENSOR_INTERVAL)
