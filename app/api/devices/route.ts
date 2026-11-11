// GET /api/devices -> { devices: DeviceDto[] }: the signed-in person's linked phones, newest first.
import type { NextRequest } from "next/server";

import { listDevices } from "@/lib/devices/service";
import { apiUser, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  return json(
    { devices: await listDevices(user.id) },
    { headers: { "cache-control": "no-store" } },
  );
};
