// The Android app asking about itself, with its device token (no session):
//   GET    /api/devices/self -> { device }   whether it is still linked (401 "Unlinked" if not)
//   DELETE /api/devices/self -> { ok }       "Unlink this phone" on the phone
import { revokeDevice, toDeviceDto } from "@/lib/devices/service";
import { deviceFromRequest } from "@/lib/devices/http";
import { json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const GET = async (req: Request) => {
  const { owner, error } = await deviceFromRequest(req);
  if (error) return error;
  return json({ device: toDeviceDto(owner.device) }, { headers: { "cache-control": "no-store" } });
};

export const DELETE = async (req: Request) => {
  const { owner, error } = await deviceFromRequest(req);
  if (error) return error;
  await revokeDevice(owner.user.id, owner.device.id);
  return json({ ok: true });
};
