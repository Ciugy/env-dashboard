import json
import sqlite3
import serial
import time
from smbus2 import SMBus
import requests


RTC_ADDR = 0x68
bus = SMBus(1)

def bcd_to_dec(b: int) -> int:
    return (b // 16) * 10 + (b % 16)

def rtc_now() -> str:
    data = bus.read_i2c_block_data(RTC_ADDR, 0x00, 7)
    sec   = bcd_to_dec(data[0] & 0x7F)
    minute = bcd_to_dec(data[1])
    hour  = bcd_to_dec(data[2] & 0x3F)
    day   = bcd_to_dec(data[4])
    month = bcd_to_dec(data[5] & 0x1F)
    year  = 2000 + bcd_to_dec(data[6])
    return f"{year}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:{sec:02d}"


SERIAL_PORT    = "/dev/ttyACM0"
BAUD_RATE      = 115200
CONTROL_URL    = "http://localhost:3000/api/control"
DB_PATH        = "./src/app/api/data/sensor_data.db"
POLL_INTERVAL  = 1.0   # seconds between actuator polls
SENSOR_INTERVAL = 0.05  # seconds between serial reads

# Deadband / hysteresis — must move this far past setpoint before switching
HYSTERESIS = 0.5  # °C

conn   = sqlite3.connect(DB_PATH, check_same_thread=False)
cursor = conn.cursor()
cursor.execute("""
    CREATE TABLE IF NOT EXISTS sensor_data (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT    NOT NULL,
        bme_temp   REAL,
        bme_press  REAL,
        bme_gas    REAL,
        scd_co2    INTEGER,
        scd_hum    REAL
    )
""")
conn.commit()


ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
time.sleep(2)
print("Serial ready")

# Latest sensor values

latest_temp:  float | None = None
latest_hum:   float | None = None
latest_press: float | None = None
latest_gas:   float | None = None
latest_co2:   int   | None = None


def update_backend(**kwargs) -> None:
    payload = dict(kwargs)  # send everything, including None/False/0
    if not payload:
        return
    try:
        requests.post(CONTROL_URL, json=payload, timeout=1)
    except Exception:
        pass


def all_off() -> None:
    """Force every actuator off and do NOT touch mode/override flags."""
    update_backend(heater=False, cooling_fan=0, humidifier=False)


def compute_actuators(current_temp: float, current_hum: float, setpoint: float):
    """
    Apply hysteresis and return (heater_on, fan_pwm, humidifier_on).
    Never call this when mode is OFF.
    """
    heater_on    = current_temp < setpoint - HYSTERESIS
    fan_pwm      = 100 if current_temp > setpoint + HYSTERESIS else 0
    # Heater and fan are mutually exclusive
    if heater_on:
        fan_pwm = 0

    humidifier_on = current_hum < 15
    return heater_on, fan_pwm, humidifier_on


def print_status(override_text: str, actuator_text: str, sensor_text: str) -> None:
    print("\033[3F", end="")
    print("\r\033[K" + override_text)
    print("\r\033[K" + actuator_text)
    print("\r\033[K" + sensor_text)


def format_sensor_text() -> str:
    return (
        f"Temp: {latest_temp:.1f}°C | "
        f"Hum: {latest_hum:.0f}% | "
        f"CO2: {latest_co2} ppm | "
        f"Press: {latest_press:.0f} hPa"
    )


def handle_serial_override(cmd: str) -> None:
    """Handle single-char commands that come straight from the ESP32."""
    if cmd == "H":
        update_backend(heater=True)
    elif cmd == "h":
        update_backend(heater=False)
    elif cmd == "F":
        update_backend(cooling_fan=100)
    elif cmd == "f":
        update_backend(cooling_fan=0)

def send_actuator_commands() -> None:
    if latest_temp is None or latest_hum is None:
        return

    try:
        state = requests.get(CONTROL_URL, timeout=1).json()
    except Exception:
        return

    mode          = state.get("mode", "OFF")
    setpoint      = state.get("setpoint")
    override_mode = state.get("overrideMode", False)
    override_sp   = state.get("overrideSetpoint")

    sensor_text = format_sensor_text()

    # Override mode — highest priority
    if override_mode:
        if override_sp is None:
            # Override enabled but no setpoint yet — safe fallback
            all_off()
            print_status(
                "Override: waiting for setpoint…",
                "Heater: OFF | Fan: 0% | Humidifier: OFF",
                sensor_text,
            )
            return

        heater_on, fan_pwm, humidifier_on = compute_actuators(
            latest_temp, latest_hum, override_sp
        )
        update_backend(
            heater=heater_on,
            cooling_fan=fan_pwm,
            humidifier=humidifier_on,
            # Deliberately NOT sending mode/overrideMode — they stay as-is
        )
        print_status(
            f"Override: ON (setpoint: {override_sp}°C)",
            f"Heater: {heater_on} | Fan: {fan_pwm}% | Humidifier: {humidifier_on}",
            sensor_text,
        )
        return

    # System is OFF — hard lock, nothing runs 
    if mode == "OFF":
        all_off()
        print_status(
            "Mode: OFF",
            "Heater: OFF | Fan: 0% | Humidifier: OFF",
            sensor_text,
        )
        return

    # Normal mode 
    if setpoint is None:
        return

    heater_on, fan_pwm, humidifier_on = compute_actuators(
        latest_temp, latest_hum, setpoint
    )

    # Keep whatever the user explicitly asked for — if we're in HEAT mode, ignore any cooling demand;
    if mode == "HEAT":
        fan_pwm = 0          # never cool in heat-only mode
    elif mode == "COOL":
        heater_on = False    # never heat in cool-only mode

    update_backend(
        heater=heater_on,
        cooling_fan=fan_pwm,
        humidifier=humidifier_on,
        # Deliberately NOT sending mode — leave it alone
    )
    print_status(
        f"Mode: {mode} (setpoint: {setpoint}°C)",
        f"Heater: {heater_on} | Fan: {fan_pwm}% | Humidifier: {humidifier_on}",
        sensor_text,
    )


# Entry point 

print("Listening for sensor data…")
print("\n\n\n\n")

last_actuator_poll = time.time()

while True:
    # Read one line from serial
    try:
        line = ser.readline().decode(errors="ignore").strip()
    except Exception as e:
        print("Serial error:", e)
        time.sleep(1)
        continue

    # Arduino commands — single-char actuator OR multi-char override
    if line in ("H", "h", "F", "f"):
        handle_serial_override(line)
        continue

    if line == "O1":
        # Override activated from physical button
        update_backend(overrideMode=True)
        print("[Override] ON")
        continue

    if line == "O0":
        # Override cleared — also wipe setpoint so a stale value
        # doesn't immediately re-arm next time override turns on
        update_backend(overrideMode=False, overrideSetpoint=None)
        print("[Override] OFF")
        continue

    if line.startswith("SP:"):
        # Setpoint from physical dial, "SP:21.5"
        try:
            sp = float(line[3:])
            update_backend(overrideSetpoint=sp)
            print(f"[Override] Setpoint -> {sp}C")
        except ValueError:
            print(f"[Override] Bad SP line: {line!r}")
        continue

    # JSON sensor payload
    if line:
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            data = None

        if data:
            ts = rtc_now()

            latest_temp  = data.get("bme_temp",  latest_temp)
            latest_press = data.get("bme_press", latest_press)
            latest_gas   = data.get("bme_gas",   latest_gas)
            latest_co2   = data.get("scd_co2",   latest_co2)
            latest_hum   = data.get("scd_hum",   latest_hum)

            cursor.execute("""
                INSERT INTO sensor_data
                    (timestamp, bme_temp, bme_press, bme_gas, scd_co2, scd_hum)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                ts,
                data.get("bme_temp"),
                data.get("bme_press"),
                data.get("bme_gas"),
                data.get("scd_co2"),
                data.get("scd_hum"),
            ))
            conn.commit()

    # Actuator poll
    if time.time() - last_actuator_poll >= POLL_INTERVAL:
        send_actuator_commands()
        last_actuator_poll = time.time()

    time.sleep(SENSOR_INTERVAL)