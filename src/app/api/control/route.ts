
import { NextResponse } from "next/server";

type ScheduleEntry = { at: number; temp: number };

let lastCommand: {
  mode: "OFF" | "HEAT" | "COOL" | "AUTO";
  setpoint: number;
  useSchedule: boolean;
  schedule: ScheduleEntry[];
  overrideMode: boolean;
  overrideSetpoint: number | null;
  heater: boolean;
  humidifier: boolean;
  cooling_fan: number;
} = {
  mode: "HEAT",
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

    if ("mode" in body) lastCommand.mode = body.mode;
    if ("setpoint" in body) lastCommand.setpoint = body.setpoint;
    if ("useSchedule" in body) lastCommand.useSchedule = !!body.useSchedule;
    if ("schedule" in body) lastCommand.schedule = body.schedule ?? [];

    if ("overrideMode" in body) lastCommand.overrideMode = !!body.overrideMode;
    if ("overrideSetpoint" in body)
      lastCommand.overrideSetpoint = body.overrideSetpoint;

    if ("heater" in body) lastCommand.heater = !!body.heater;
    if ("humidifier" in body) lastCommand.humidifier = !!body.humidifier;
    if ("cooling_fan" in body) lastCommand.cooling_fan = body.cooling_fan;

    return NextResponse.json(lastCommand);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
