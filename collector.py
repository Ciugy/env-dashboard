import sqlite3
import serial
import json
import time
from datetime import datetime
import requests

# Open database
conn = sqlite3.connect("./src/app/api/data/sensor_data.db")
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

serial_port = "/dev/ttyACM0"
baud_rate = 115200

ser = serial.Serial(serial_port, baud_rate, timeout=2)
time.sleep(2)

print("Listening...")

def get_control_command():
    try:
        r = requests.get("http://localhost:3000/api/control", timeout=1)
        if r.status_code == 200:
            return r.json()
    except:
        return None

while True:
    # 1. Read sensor data
    line = ser.readline().decode(errors="ignore").strip()
    if line:
        parts = [p.strip() for p in line.split(",")]
        data = {}

        for p in parts:
            if ":" in p:
                key, value = p.split(":", 1)
                key = key.strip().lower()
                value = value.strip()

                try:
                    if "." in value:
                        value = float(value)
                    else:
                        value = int(value)
                except:
                    continue

                data[key] = value

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

    # 2. Send commands to Arduino
    cmd = get_control_command()
    if cmd:
        if cmd.get("led") == True:
            ser.write(b'1')
        else:
            ser.write(b'0')

    time.sleep(0.1)
