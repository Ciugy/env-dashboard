import sqlite3
import serial
import json
import time
from datetime import datetime
import threading
import websocket

# --- DB setup ---
conn = sqlite3.connect("./src/app/api/data/sensor_data.db", check_same_thread=False)
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

# Serial setup
ser = serial.Serial("/dev/ttyACM0", 115200, timeout=2)
time.sleep(2)
print("Serial ready")

# WebSocket setup
WS_URL = "ws://localhost:3000/api/ws"
ws = None

def ws_on_message(ws, message):
    try:
        data = json.loads(message)
    except:
        return

    if data.get("type") == "command":
        # Heater
        if "heater" in data:
            ser.write(b'H' if data["heater"] else b'h')

        # Fan
        if "fan" in data:
            ser.write(b'F' if data["fan"] else b'f')

        # Humidifier
        if "humidifier" in data:
            ser.write(b'U' if data["humidifier"] else b'u')

def ws_on_open(ws):
    print("WebSocket connected")

def ws_on_close(ws, code, msg):
    print("WebSocket closed", code, msg)

def ws_thread():
    global ws
    while True:
        try:
            ws = websocket.WebSocketApp(
                WS_URL,
                on_message=ws_on_message,
                on_open=ws_on_open,
                on_close=ws_on_close,
            )
            ws.run_forever()
        except Exception as e:
            print("WS error:", e)
            time.sleep(2)

threading.Thread(target=ws_thread, daemon=True).start()

# Main loop: read serial, save to DB, push to UI
def parse_line(line):
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

print("Listening for sensor data...")

while True:
    line = ser.readline().decode(errors="ignore").strip()
    if not line:
        continue

    data = parse_line(line)
    if not data:
        continue

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

    # Push live sensor data to UI
    if ws and ws.sock and ws.sock.connected:
        ws.send(json.dumps({
            "type": "sensor",
            "timestamp": ts,
            "bme_temp": data.get("bme_temp"),
            "bme_press": data.get("bme_press"),
            "bme_gas": data.get("bme_gas"),
            "scd_co2": data.get("scd_co2"),
            "scd_hum": data.get("scd_hum"),
        }))

    time.sleep(0.05)
