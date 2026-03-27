import json
import sqlite3
import serial
import time
from datetime import datetime
import requests

SERIAL_PORT = "/dev/ttyACM0"
BAUD_RATE = 115200

CONTROL_URL = "http://localhost:3000/api/control"
DB_PATH = "./src/app/api/data/sensor_data.db"

POLL_INTERVAL = 1.0      # how often we run actuator logic
SENSOR_INTERVAL = 0.05   # how often we poll serial


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


# UPDATE BACKEND STATE
def update_backend(heater=None, humidifier=None, cooling_fan=None, mode=None, overrideSetpoint=None, overrideMode=None):
    payload = {}

    if heater is not None:
        payload["heater"] = heater
    if humidifier is not None:
        payload["humidifier"] = humidifier
    if cooling_fan is not None:
        payload["cooling_fan"] = cooling_fan
    if mode is not None:
        payload["mode"] = mode
    if overrideSetpoint is not None:
        payload["overrideSetpoint"] = overrideSetpoint
    if overrideMode is not None:
        payload["overrideMode"] = overrideMode

    if not payload:
        return

    try:
        requests.post(CONTROL_URL, json=payload, timeout=1)
    except:
        pass


# HANDLE OVERRIDE COMMANDS FROM ARDUINO
def handle_override_command(cmd):
    try:
        res = requests.get(CONTROL_URL, timeout=1)
        state = res.json()
    except:
        return

    if state.get("overrideSetpoint") is None:
        state["overrideSetpoint"] = state.get("setpoint", 22)

    override_sp = state.get("overrideSetpoint", state.get("setpoint", 22))

    if cmd == "O1":
        update_backend(overrideMode=True)

    elif cmd == "O0":
        update_backend(overrideMode=False)

    elif cmd == "SP+":
        override_sp = override_sp + 0.5
        update_backend(overrideSetpoint=override_sp)

    elif cmd == "SP-":
        override_sp = override_sp - 0.5
        update_backend(overrideSetpoint=override_sp)

    elif cmd == "H":
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

    # Need valid sensor data
    if latest_temp is None or latest_hum is None:
        return

    try:
        res = requests.get(CONTROL_URL, timeout=1)
        state = res.json()
    except:
        return

    mode = state.get("mode")
    setpoint = state.get("setpoint")
    if setpoint is None:
        return

    current_temp = latest_temp
    current_hum = latest_hum
    lag = 0.3

    if state.get("overrideMode"):
        override_sp = state.get("overrideSetpoint", setpoint)

        # Decide mode based on override setpoint vs current temp
        if override_sp is not None:
            if current_temp > override_sp + 0.3:
                mode = "COOL"
            elif current_temp < override_sp - 0.3:
                mode = "HEAT"
            else:
                mode = "OFF"

        heater_on = state.get("heater", False)
        humidifier_on = state.get("humidifier", False)
        fan_pwm = state.get("cooling_fan", 0)

        update_backend(
            mode=mode,
            heater=heater_on,
            humidifier=humidifier_on,
            cooling_fan=fan_pwm,
            overrideSetpoint=override_sp,
            overrideMode=True
        )
        return


    # Apply override setpoint if active (but not full overrideMode)
    if state.get("overrideSetpoint") is not None:
        setpoint = state["overrideSetpoint"]

    # Start with backend values
    heater_on = state.get("heater", False)
    fan_pwm = state.get("cooling_fan", 0)
    humidifier_on = state.get("humidifier", False)

    # OFF MODE
    if mode == "OFF":
        update_backend(
            mode="OFF",
            heater=False,
            humidifier=False,
            cooling_fan=0
        )
        return

    # HEAT MODE
    if mode == "HEAT":
        # Heater logic
        if current_temp < setpoint - lag:
            heater_on = True
        elif current_temp > setpoint + lag:
            heater_on = False

        # Humidifier logic
        if current_hum < 15:
            humidifier_on = True
        elif current_hum > 25:
            humidifier_on = False

        # Fan stays in user controlled in HEAT
        fan_pwm = state.get("cooling_fan", 0)

        update_backend(
            mode="HEAT",
            heater=heater_on,
            humidifier=humidifier_on,
            cooling_fan=fan_pwm
        )
        return

    # COOL MODE
    if mode == "COOL":
        heater_on = False  # never heat in COOL
        humidifier_on = state.get("humidifier", False)

        # Fan stays in user controlled in COOL
        fan_pwm = state.get("cooling_fan", 0)

        update_backend(
            mode="COOL",
            heater=heater_on,
            humidifier=humidifier_on,
            cooling_fan=fan_pwm
        )
        return

    # AUTO MODE
    if mode == "AUTO":
        diff = current_temp - setpoint

        # AUTO COOLING
        if diff > 0.5:
            auto_fan = int((diff / 3.0) * 100)
            auto_fan = min(max(auto_fan, 20), 100)
            fan_pwm = auto_fan
            heater_on = False

        # AUTO HEATING
        elif diff < -0.5:
            heater_on = True
            fan_pwm = 30  # gentle airflow

        # COMFORT BAND
        else:
            heater_on = False
            fan_pwm = state.get("cooling_fan", 0)

        # Humidifier logic in AUTO
        if current_hum < 15:
            humidifier_on = True
        elif current_hum > 25:
            humidifier_on = False

        update_backend(
            mode="AUTO",
            heater=heater_on,
            humidifier=humidifier_on,
            cooling_fan=fan_pwm
        )
        return


print("Listening for sensor data...")

last_actuator_poll = time.time()

while True:
    try:
        line = ser.readline().decode(errors="ignore").strip()
    except Exception as e:
        print("Serial error:", e)
        time.sleep(1)
        continue

    # HANDLE OVERRIDE COMMANDS FIRST
    if line in ["O1", "O0", "SP+", "SP-", "H", "h", "F", "f"]:
        handle_override_command(line)
        continue

    # SENSOR JSON LINES
    if line:
        try:
            data = json.loads(line)
        except:
            data = None

        if data:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Update in-memory latest values
            latest_temp = data.get("bme_temp", latest_temp)
            latest_press = data.get("bme_press", latest_press)
            latest_gas = data.get("bme_gas", latest_gas)
            latest_co2 = data.get("scd_co2", latest_co2)
            latest_hum = data.get("scd_hum", latest_hum)

            # Store to DB
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

    # PERIODIC ACTUATOR LOGIC
    if time.time() - last_actuator_poll >= POLL_INTERVAL:
        send_actuator_commands()
        last_actuator_poll = time.time()

    time.sleep(SENSOR_INTERVAL)
