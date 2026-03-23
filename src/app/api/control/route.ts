import { NextResponse } from "next/server";

type Mode = "OFF" | "HEAT" | "COOL" | "AUTO";
type ScheduleEntry = { at: number; temp: number };

interface CommandState {
  mode: Mode;
  setpoint: number;
  useSchedule: boolean;
  schedule: ScheduleEntry[];
  overrideMode: boolean;
  overrideSetpoint: number | null;
  heater: boolean;
  humidifier: boolean;
  cooling_fan: number; // 0–100
}

let lastCommand: CommandState = {
  mode: "OFF",
  setpoint: 22,
  useSchedule: false,
  schedule: [],
  overrideMode: false,
  overrideSetpoint: null,
  heater: false,
  humidifier: false,
  cooling_fan: 0,
};

export async function GET() {
  return NextResponse.json(lastCommand);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // MODE
    if ("mode" in body) {
      const m = body.mode;
      if (m === "OFF" || m === "HEAT" || m === "COOL" || m === "AUTO") {
        lastCommand.mode = m;
      }
    }

    // SETPOINT, checks if its a valid value !isNaN = NOT a Number
    if ("setpoint" in body) {
      const sp = Number(body.setpoint);
      if (!isNaN(sp) && sp >= 5 && sp <= 40) {
        lastCommand.setpoint = sp;
      }
    }

    // SCHEDULE
    if ("useSchedule" in body) {
      lastCommand.useSchedule = !!body.useSchedule;
    }

    if ("schedule" in body && Array.isArray(body.schedule)) {
      lastCommand.schedule = body.schedule;
    }

    // OVERRIDE
    if ("overrideMode" in body) {
      lastCommand.overrideMode = !!body.overrideMode;
    }

    if ("overrideSetpoint" in body) {
      const osp = body.overrideSetpoint;
      if (osp === null || (typeof osp === "number" && osp >= 5 && osp <= 40)) {
        lastCommand.overrideSetpoint = osp;
      }
    }

    // ACTUATORS
    if ("heater" in body) lastCommand.heater = !!body.heater;
    if ("humidifier" in body) lastCommand.humidifier = !!body.humidifier;

    if ("cooling_fan" in body) {
      const fan = Number(body.cooling_fan);
      // Checks if its a number and if its between 0-100
      if (!isNaN(fan)) {
        lastCommand.cooling_fan = Math.min(Math.max(fan, 0), 100);
      }
    }

    return NextResponse.json(lastCommand);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
