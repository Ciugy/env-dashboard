import time
import requests
from pyfirmata import Arduino

API_URL = "http://localhost:3000/api/control"
BOARD_PORT = "/dev/ttyACM0"

board = Arduino(BOARD_PORT)
led = board.get_pin("d:2:o")

def get_command():
    try:
        r = requests.get(API_URL, timeout=2)
        if r.status_code == 200:
            return r.json()
    except:
        pass
    return None

while True:
    cmd = get_command()
    if cmd:
        led.write(1 if cmd.get("led") else 0)
    time.sleep(1)
