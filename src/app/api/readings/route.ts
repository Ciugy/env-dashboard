import { NextResponse } from "next/server";
import sqlite3 from "sqlite3";
 import { open } from "sqlite";

 export async function GET() {
   try {
   
     const db = await open({
       filename: "/home/alexpi/Desktop/appv2/env-dashboard/src/app/api/data/sensor_data.db",
       driver: sqlite3.Database,
     });

     // Query the latest 50 readings
     const rows = await db.all(`
       SELECT 
         timestamp,
         bme_temp,
         bme_press,
         bme_gas,
         scd_co2,
         scd_hum
       FROM sensor_data
       ORDER BY id DESC
       LIMIT 50
     `);

     return NextResponse.json(rows);
   } catch (err: any) {
     console.error("DB ERROR:", err);
     return NextResponse.json(
       { error: "Failed to read database" },
       { status: 500 }
     );
   }
 }
