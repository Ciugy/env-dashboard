#import pyfirmata
import sqlite3
import serial
import json
import time
from datetime import datetime

# Open database
conn = sqlite3.connect("./src/app/api/data/sensor_data.db")
cursor = conn.cursor()

# Create structured table
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

# Arduino resets when serial opens
time.sleep(2)

print("Listening...")

while True:
    line = ser.readline().decode(errors="ignore").strip()
    if not line:
        continue

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
                timestamp, bme_temp,  bme_press, bme_gas,
                scd_co2,  scd_hum
            ) VALUES (? ,?, ?, ?, ?, ?)
        """, (
            ts,
            data.get("bme_temp"),
            data.get("bme_press"),   # your Arduino sends pressure second
            data.get("bme_gas"),
            data.get("scd_co2"),
            data.get("scd_hum")
        ))

        conn.commit()

        print("Saved:", ts, data)
