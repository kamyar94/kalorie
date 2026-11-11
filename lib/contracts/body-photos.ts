// CONTRACT: guided body photos (boards 8 and 11). A session is one day's photos, at most one per
// pose (Front, Left, Back, Right); taking a pose again that day replaces it. Originals are kept at
// full size (metadata removed) next to a view copy and a thumbnail, for a later 3D step that reads
// the sessions (date, pose, original). Body photos are the person's own: owner-only routes, never
// sent to an AI, not on the admin page. Plain data, safe for client components.
//
// Server functions (lib/body/photos.ts), scoped by user id:
//   saveBodyPhoto(userId, BodyPhotoUpload)   -> { session, photo }
//   listBodySessions(userId)                 -> BodySessionDto[]   newest first
//   deleteBodyPhoto(userId, photoId)         -> boolean
//   bodyPhotoPath(userId, photoId, size)     -> stored path or null
// HTTP: GET/POST /api/body-photos, DELETE /api/body-photos/:id,
// GET /api/body-photos/:id/:size (thumb | view | original).

export const BODY_POSES = ["front", "left", "back", "right"] as const;
export type BodyPose = (typeof BODY_POSES)[number];

export const POSE_LABELS: Record<BodyPose, string> = {
  front: "Front",
  left: "Left",
  back: "Back",
  right: "Right",
};

export const isBodyPose = (value: unknown): value is BodyPose =>
  typeof value === "string" && (BODY_POSES as readonly string[]).includes(value);

/** How to stand for each pose (board 8). */
export const POSE_GUIDES: Record<BodyPose, string> = {
  front:
    "Stand about 2 m away, arms slightly out, feet hip-width. Same spot, light and clothes each time.",
  left: "Turn so your left side faces the camera, arms by your sides, looking ahead.",
  back: "Turn your back to the camera, arms slightly out, feet hip-width.",
  right: "Turn so your right side faces the camera, arms by your sides, looking ahead.",
};

export const BODY_PHOTO_NOTICE =
  "Body photos stay on your own server, visible only to you, and are never sent to an AI.";

/** Self-timer choices in seconds (0: off). */
export const SELF_TIMERS = [0, 3, 10] as const;

export const BODY_PHOTO_LIMITS = {
  /** One full-size photo per request. */
  maxBytes: 20 * 1024 * 1024,
} as const;

export type BodyPhotoSize = "thumb" | "view" | "original";

export type BodyPhotoDto = {
  id: string;
  pose: BodyPose;
  takenAt: string;
  width: number;
  height: number;
  /** The camera that took it ("user" is the front camera), when known. */
  facing: "user" | "environment" | null;
  source: "camera" | "gallery";
  urls: Record<BodyPhotoSize, string>;
};

export type BodySessionDto = {
  id: string;
  localDate: string;
  tz: string;
  photos: BodyPhotoDto[];
};

export type BodyPhotoUpload = {
  photo: Buffer;
  pose: BodyPose;
  takenAt: string;
  tz: string;
  facing: "user" | "environment" | null;
  source: "camera" | "gallery";
};
