import { NextResponse } from "next/server";

let lastCommand: any = {
  mode: "HEAT",
  setpoint: 22,
  useSchedule: true,
  schedule: [],
  heater: false,
  fan: false,
  humidifier: false,
  led: false,
};

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if ("mode" in body) lastCommand.mode = body.mode;
    if ("setpoint" in body) lastCommand.setpoint = body.setpoint;
    if ("useSchedule" in body) lastCommand.useSchedule = body.useSchedule;
    if ("schedule" in body) lastCommand.schedule = body.schedule;

    if ("heater" in body) lastCommand.heater = !!body.heater;
    if ("fan" in body) lastCommand.fan = !!body.fan;
    if ("humidifier" in body) lastCommand.humidifier = !!body.humidifier;
    if ("led" in body) lastCommand.led = !!body.led;

    return NextResponse.json({ ok: true, command: lastCommand });
  } catch (err) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json(lastCommand);
}
