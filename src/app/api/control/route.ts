import { NextResponse } from "next/server";

let lastCommand: any = {
  led: false,
  heater: false,
  fan: false,
  humidifier: false,
};

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if ("led" in body) {
      lastCommand.led = !!body.led;
    }

    if ("heater" in body) {
      lastCommand.heater = !!body.heater;
    }

    if ("fan" in body) {
      lastCommand.fan = !!body.fan;
    }

    if ("humidifier" in body) {
      lastCommand.humidifier = !!body.humidifier;
    }

    return NextResponse.json({
      ok: true,
      command: lastCommand,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json(lastCommand);
}
