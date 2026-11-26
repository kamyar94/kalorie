// Made-up meal photos for the "Add photos" tests: drawn by this script (a shape of one colour on
// another, never a real photo), JPEG, with a made-up EXIF time taken when given and no other
// metadata.
import sharp from "sharp";

export type FixturePhoto = {
  name: string;
  /** Background and shape colours. */
  colours: [string, string];
  shape?: "disc" | "bar" | "ring";
  /** EXIF time taken, "YYYY:MM:DD HH:MM:SS" (exifTime); none for a photo with no time. */
  takenAt?: string;
  /** 480 x 640 instead of 640 x 480, so the stored photo can be told apart by its size. */
  portrait?: boolean;
};

/** EXIF date text for a local day (YYYY-MM-DD) and time (HH:MM), read in the device's zone. */
export const exifTime = (day: string, time: string) => `${day.replaceAll("-", ":")} ${time}:00`;

const SHAPES = {
  disc: (fg: string, w: number, h: number) =>
    `<circle cx="${w / 2}" cy="${h / 2}" r="150" fill="${fg}"/>`,
  bar: (fg: string, w: number, h: number) =>
    `<rect x="80" y="${h / 2 - 70}" width="${w - 160}" height="140" rx="30" fill="${fg}"/>`,
  ring: (fg: string, w: number, h: number) =>
    `<circle cx="${w / 2}" cy="${h / 2}" r="140" fill="none" stroke="${fg}" stroke-width="60"/>`,
};

export const fixturePhoto = async ({
  colours: [bg, fg],
  shape = "disc",
  takenAt,
  portrait = false,
}: FixturePhoto) => {
  const [w, h] = portrait ? [480, 640] : [640, 480];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${SHAPES[shape](fg, w, h)}</svg>`;
  const image = sharp(Buffer.from(svg)).jpeg({ quality: 85 });
  return (takenAt ? image.withExif({ IFD2: { DateTimeOriginal: takenAt } }) : image).toBuffer();
};

/** The photos as files for setInputFiles / a file chooser. */
export const fixtureFiles = (photos: FixturePhoto[]) =>
  Promise.all(
    photos.map(async (photo) => ({
      name: `${photo.name.replace(/\W+/g, "-")}.jpg`,
      mimeType: "image/jpeg",
      buffer: await fixturePhoto(photo),
    })),
  );
