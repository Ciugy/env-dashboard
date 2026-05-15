import json
import sqlite3
import serial
import time
from smbus2 import SMBus
import requests

# ─── RTC ─────────────────────────────────────────────────────────────────────

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

# ─── Config ───────────────────────────────────────────────────────────────────

SERIAL_PORT    = "/dev/ttyACM0"
BAUD_RATE      = 115200
CONTROL_URL    = "http://localhost:3000/api/control"
DB_PATH        = "./src/app/api/data/sensor_data.db"
POLL_INTERVAL  = 1.0   # seconds between actuator polls
SENSOR_INTERVAL = 0.05  # seconds between serial reads

# Deadband / hysteresis — must move this far past setpoint before switching
HYSTERESIS = 0.5  # °C

# CO2 ventilation thresholds
CO2_WARN     = 800   # ppm — elevated, fan starts at minimum speed
CO2_HIGH     = 1200  # ppm — poor air quality, fan runs at full speed
CO2_FAN_MIN  = 40    # % duty at CO2_WARN
CO2_FAN_FULL = 100   # % duty at CO2_HIGH and above

# ─── Database ─────────────────────────────────────────────────────────────────

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

# ─── Serial ───────────────────────────────────────────────────────────────────

ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
time.sleep(2)
print("Serial ready")

# ─── Latest sensor values ─────────────────────────────────────────────────────

latest_temp:  float | None = None
latest_hum:   float | None = None
latest_press: float | None = None
latest_gas:   float | None = None
latest_co2:   int   | None = None

# ─── Helpers ──────────────────────────────────────────────────────────────────

def update_backend(**kwargs) -> None:
    """POST only the keys that are explicitly provided.
    We keep False and 0 (they are valid values) but we do allow
    explicit None values through — the backend treats null as a clear."""
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


def co2_fan_speed(co2: int | None) -> int:
    """
    Returns the fan duty cycle (0-100) demanded purely by CO2 level.
    Linearly ramps from CO2_FAN_MIN at CO2_WARN to CO2_FAN_FULL at CO2_HIGH.
    Returns 0 if CO2 is unknown or below the warning threshold.
    """
    if co2 is None or co2 < CO2_WARN:
        return 0
    if co2 >= CO2_HIGH:
        return CO2_FAN_FULL
    # Linear interpolation between WARN and HIGH
    ratio = (co2 - CO2_WARN) / (CO2_HIGH - CO2_WARN)
    return int(CO2_FAN_MIN + ratio * (CO2_FAN_FULL - CO2_FAN_MIN))


def compute_actuators(current_temp: float, current_hum: float, setpoint: float, mode: str = "AUTO"):
    """
    Apply hysteresis and return (heater_on, fan_pwm, humidifier_on).
    Never call this when mode is OFF.

    Thermal and CO2 demands are computed independently then combined:

    - HEAT mode: heater fires when below setpoint. CO2 ventilation fan
      can run simultaneously — fresh air while heating is fine. Thermal
      cooling fan is blocked (mode says heat only).

    - COOL mode: fan fires when above setpoint. CO2 fan adds to that.
      Heater is blocked (mode says cool only).

    - AUTO mode: heater OR thermal fan based on temperature. If the
      heater is actively needed (temp below setpoint), CO2 fan runs
      but the heater is NOT suppressed — CO2 ventilation and heating
      coexist. If thermal cooling is active (temp above setpoint),
      heater is suppressed as the two would fight each other.
    """
    needs_heat = current_temp < setpoint - HYSTERESIS
    needs_cool = current_temp > setpoint + HYSTERESIS

    # Thermal decisions gated by mode
    if mode == "HEAT":
        heater_on   = needs_heat
        thermal_fan = 0           # never run cooling fan in heat-only mode
    elif mode == "COOL":
        heater_on   = False       # never heat in cool-only mode
        thermal_fan = 100 if needs_cool else 0
    else:  # AUTO
        heater_on   = needs_heat and not needs_cool
        thermal_fan = 100 if needs_cool else 0

    # CO2 ventilation — independent of thermal direction
    ventilation_fan = co2_fan_speed(latest_co2)

    # Take the higher fan demand
    fan_pwm = max(thermal_fan, ventilation_fan)

    # Only suppress the heater when THERMAL cooling is active — not just
    # because the CO2 fan is running. CO2 ventilation + heating is safe
    # and intentional (fresh air while warming the room).
    if thermal_fan > 0 and heater_on:
        heater_on = False

    humidifier_on = current_hum < 15
    return heater_on, fan_pwm, humidifier_on


def print_status(override_text: str, actuator_text: str, sensor_text: str) -> None:
    print("\033[3F", end="")
    print("\r\033[K" + override_text)
    print("\r\033[K" + actuator_text)
    print("\r\033[K" + sensor_text)


def format_sensor_text() -> str:
    co2_str = f"{latest_co2} ppm"
    if latest_co2 is not None:
        if latest_co2 >= CO2_HIGH:
            co2_str += " [POOR]"
        elif latest_co2 >= CO2_WARN:
            co2_str += " [WARN]"
    return (
        f"Temp: {latest_temp:.1f}°C | "
        f"Hum: {latest_hum:.0f}% | "
        f"CO2: {co2_str} | "
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

# ─── Main control loop ────────────────────────────────────────────────────────

def send_actuator_commands() -> None:
    """
    Fetch control state once, decide what the actuators should do,
    push only the actuator fields back — never touch mode/overrideMode.
    """
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

    # ── 1. Override mode — highest priority, even beats OFF ──────────────────
    #
    # Override is a physical button on the device — if someone is standing
    # there pressing it, they want the system to respond regardless of what
    # mode the frontend last set.
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
            latest_temp, latest_hum, override_sp, mode="AUTO"
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

    # ── 2. System is OFF — hard lock, nothing runs ───────────────────────────
    if mode == "OFF":
        all_off()
        print_status(
            "Mode: OFF",
            "Heater: OFF | Fan: 0% | Humidifier: OFF",
            sensor_text,
        )
        return

    # ── 3. Normal mode ────────────────────────────────────────────────────────
    # Note: the frontend fan slider can also POST cooling_fan values.
    # That's fine — the Pi re-computes and overwrites it every POLL_INTERVAL
    # so CO2/thermal logic always wins within one second.
    if setpoint is None:
        return

    heater_on, fan_pwm, humidifier_on = compute_actuators(
        latest_temp, latest_hum, setpoint, mode=mode
    )
    # Mode-gating is now handled inside compute_actuators

    update_backend(
        heater=heater_on,
        cooling_fan=fan_pwm,
        humidifier=humidifier_on,
        # Deliberately NOT sending mode — leave it alone
    )

    # Build a fan reason tag for the terminal so it's clear why the fan is on
    fan_reason = ""
    if fan_pwm > 0:
        thermal_cooling = latest_temp is not None and latest_temp > setpoint + HYSTERESIS
        co2_demand      = latest_co2 is not None and latest_co2 >= CO2_WARN
        reasons = []
        if thermal_cooling: reasons.append("thermal cooling")
        if co2_demand:      reasons.append(f"CO2 {latest_co2}ppm")
        if heater_on:       reasons.append("+ heater coexist")
        if reasons: fan_reason = f" ({', '.join(reasons)})"

    print_status(
        f"Mode: {mode} (setpoint: {setpoint}°C)",
        f"Heater: {heater_on} | Fan: {fan_pwm}%{fan_reason} | Humidifier: {humidifier_on}",
        sensor_text,
    )


# ─── Entry point ──────────────────────────────────────────────────────────────

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

    # ESP32 commands — single-char actuator OR multi-char override
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
        # Setpoint from physical dial, e.g. "SP:21.5"
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