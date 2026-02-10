
import { NextResponse } from "next/server";

type ScheduleEntry = { at: number; temp: number };

let lastCommand: {
  mode: "OFF" | "HEAT";
  setpoint: number;
  useSchedule: boolean;
  schedule: ScheduleEntry[];
  overrideMode: boolean;
  overrideSetpoint: number | null;
  heater: boolean;
  fan: boolean;
  humidifier: boolean;
  led: boolean;
} = {
  mode: "HEAT",
  setpoint: 22,
  useSchedule: false,
  schedule: [],
  overrideMode: false,
  overrideSetpoint: null,
  heater: false,
  fan: false,
  humidifier: false,
  led: false,
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
    if ("fan" in body) lastCommand.fan = !!body.fan;
    if ("humidifier" in body) lastCommand.humidifier = !!body.humidifier;
    if ("led" in body) lastCommand.led = !!body.led;

    return NextResponse.json(lastCommand);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
