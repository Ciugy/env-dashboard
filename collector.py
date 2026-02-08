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

POLL_INTERVAL = 0.10   # 100 ms for actuator polling
SENSOR_INTERVAL = 0.05 # 50 ms for serial read loop

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


# PARSE CSV FROM ARDUINO
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

# SEND ACTUATOR COMMANDS
def send_actuator_commands():
    try:
        res = requests.get(CONTROL_URL, timeout=1)
        raw = res.json()
        state = raw
        print("RAW:", raw)
    except Exception:
        return
    
    # THERMOSTAT LOGIC
    mode = state.get("mode")
    setpoint = state.get("setpoint")
    useSchedule = state.get("useSchedule")
    schedule = state.get("schedule", [])

    # Read latest temperature from DB
    cursor.execute("SELECT bme_temp FROM sensor_data ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    current_temp = row[0] if row else None

    if current_temp is not None:
        hysteresis = 0.3

    print("TEMP:", current_temp, "SETPOINT:", setpoint, "MODE:", mode)

    if mode == "HEAT":
        if current_temp < setpoint - hysteresis:
            print("→ Sending H (heater ON)")
            ser.write(b'H')
        elif current_temp > setpoint + hysteresis:
            print("→ Sending h (heater OFF)")
            ser.write(b'h')

    # MANUAL OVERRIDES 
    if state.get("heater") is True:
        ser.write(b'H')
    elif state.get("heater") is False:
        ser.write(b'h')

    if state.get("fan") is True:
        ser.write(b'F')
    elif state.get("fan") is False:
        ser.write(b'f')

    if state.get("humidifier") is True:
        ser.write(b'U')
    elif state.get("humidifier") is False:
        ser.write(b'u')


print("Listening for sensor data...")

last_actuator_poll = time.time()

while True:
    #Read sensor data 
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

            print("Saved:", ts, data)


    # Poll actuator state every 100 ms 
    if time.time() - last_actuator_poll >= POLL_INTERVAL:
        send_actuator_commands()
        last_actuator_poll = time.time()

    time.sleep(SENSOR_INTERVAL)
    
