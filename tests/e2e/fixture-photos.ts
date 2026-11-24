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
};

/** EXIF date text for a local day (YYYY-MM-DD) and time (HH:MM), read in the device's zone. */
export const exifTime = (day: string, time: string) => `${day.replaceAll("-", ":")} ${time}:00`;

const SHAPES = {
  disc: (fg: string) => `<circle cx="320" cy="240" r="150" fill="${fg}"/>`,
  bar: (fg: string) => `<rect x="80" y="170" width="480" height="140" rx="30" fill="${fg}"/>`,
  ring: (fg: string) =>
    `<circle cx="320" cy="240" r="140" fill="none" stroke="${fg}" stroke-width="60"/>`,
};

export const fixturePhoto = async ({
  colours: [bg, fg],
  shape = "disc",
  takenAt,
}: FixturePhoto) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${bg}"/>${SHAPES[shape](fg)}</svg>`;
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
