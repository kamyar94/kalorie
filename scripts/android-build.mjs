// Builds the Kal Android app (android/) inside Docker and writes kal.apk and version.json:
//
//   node scripts/android-build.mjs --out <folder> --signing <folder>
//        [--properties <file>] [--cache <folder>] [--accept-sdk-licenses]
//
//   --out          where kal.apk and version.json go (copy both to the server's deploy/android)
//   --signing      a private folder outside the repository for the release key: kal-release.jks
//                  and keystore.properties (random passwords) are made there on the first run and
//                  mounted read-only into the build. Keep it with your backups: Android installs
//                  updates only when they are signed with the same key.
//   --properties   kal.host and kal.appId (default android/kal.properties; see
//                  android/kal.properties.example)
//   --cache        the Android SDK, the Gradle distribution and Gradle's caches (default
//                  android/.cache, git-ignored). Nothing large goes into the Docker image.
//   --accept-sdk-licenses
//                  accepts the Android SDK licenses with sdkmanager (needed once per cache; read
//                  them first with: sdkmanager --licenses inside the image)
//
// Steps: the image (Eclipse Temurin JDK 21 from Docker Hub, android/docker/Dockerfile); the SDK
// command-line tools from Google's official address, checked against their published SHA-256;
// the SDK platform and build tools through sdkmanager; the build with the Gradle wrapper (its
// distribution is checked against the SHA-256 in gradle-wrapper.properties; libraries come from
// Google's Maven repository and Maven Central); the JVM unit tests; signing; apksigner verify;
// aapt2 dump badging. It prints the package, versions, size, permissions and the certificate's
// SHA-256 (the value for ANDROID_CERT_SHA256 on the server). It never prints the passwords.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");

const IMAGE = "kal-android-build:1";
const CMDLINE_TOOLS = {
  file: "commandlinetools-linux-15859902_latest.zip",
  url: "https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip",
  // As published on https://developer.android.com/studio (command line tools only).
  sha256: "4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583",
};
const PLATFORM = "android-37.0";
const BUILD_TOOLS = "37.0.0";
const SDK_PACKAGES = [`platforms;${PLATFORM}`, `build-tools;${BUILD_TOOLS}`];

const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = { acceptLicenses: false };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next) fail(`${name} needs a value.`);
      return path.resolve(next);
    };
    if (name === "--out") args.out = value();
    else if (name === "--signing") args.signing = value();
    else if (name === "--properties") args.properties = value();
    else if (name === "--cache") args.cache = value();
    else if (name === "--accept-sdk-licenses") args.acceptLicenses = true;
    else fail(`Unknown option ${name}. See the top of scripts/android-build.mjs.`);
  }
  if (!args.out || !args.signing)
    fail("Give --out <folder> and --signing <folder> (see the top of this script).");
  args.properties ??= path.join(androidDir, "kal.properties");
  args.cache ??= path.join(androidDir, ".cache");
  return args;
};

/** Runs a command; with capture, returns its output instead of showing it. */
const run = (command, args, { capture = false, env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: env ? { ...process.env, ...env } : process.env,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${command} ${args[0]} ended with ${code}\n${out}`)),
    );
  });

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

const readProperties = async (file) =>
  Object.fromEntries(
    (await readFile(file, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")).trim(),
        line.slice(line.indexOf("=") + 1).trim(),
      ]),
  );

/**
 * docker run in the build image with the cache mounts, more mounts, and secret values handed
 * over through the environment (`-e NAME` takes the value from this process, never from argv).
 */
const inImage = (cache, mounts, command, { capture = false, secrets = {} } = {}) =>
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${path.join(cache, "sdk")}:/opt/android-sdk`,
      "-v",
      `${path.join(cache, "gradle")}:/cache/gradle`,
      "-v",
      `${path.join(cache, "android-user")}:/cache/android-user`,
      ...mounts.flatMap((m) => ["-v", m]),
      ...Object.keys(secrets).flatMap((name) => ["-e", name]),
      IMAGE,
      "sh",
      "-c",
      command,
    ],
    { capture, env: secrets },
  );

const step = (text) => console.log(`\n== ${text}`);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (spawnSync("docker", ["version"], { stdio: "ignore" }).status !== 0)
    fail("Docker is not running. Start Docker Desktop and try again.");
  if (!existsSync(args.properties))
    fail(
      `No ${args.properties}. Copy android/kal.properties.example and set kal.host and kal.appId.`,
    );
  const props = await readProperties(args.properties);
  if (!props["kal.host"] || !props["kal.appId"])
    fail(`${args.properties} needs kal.host and kal.appId.`);

  for (const dir of ["sdk", "gradle", "android-user", "downloads"])
    await mkdir(path.join(args.cache, dir), { recursive: true });
  await mkdir(args.out, { recursive: true });
  await mkdir(args.signing, { recursive: true });

  step("Build image");
  await run("docker", ["build", "-q", "-t", IMAGE, path.join(androidDir, "docker")]);

  const sdk = path.join(args.cache, "sdk");
  if (!existsSync(path.join(sdk, "cmdline-tools", "latest", "bin", "sdkmanager"))) {
    step("Android SDK command-line tools");
    const zip = path.join(args.cache, "downloads", CMDLINE_TOOLS.file);
    if (!existsSync(zip)) {
      console.log(`Downloading ${CMDLINE_TOOLS.url}`);
      const response = await fetch(CMDLINE_TOOLS.url);
      if (!response.ok) fail(`Download failed: ${response.status}`);
      await writeFile(`${zip}.part`, Buffer.from(await response.arrayBuffer()));
      await rename(`${zip}.part`, zip);
    }
    const digest = await sha256File(zip);
    if (digest !== CMDLINE_TOOLS.sha256) {
      await rm(zip, { force: true });
      fail(`The command-line tools' SHA-256 is ${digest}, not the published one. Removed it.`);
    }
    console.log("SHA-256 matches the published value.");
    await inImage(
      args.cache,
      [`${path.join(args.cache, "downloads")}:/downloads:ro`],
      `set -e; mkdir -p /opt/android-sdk/cmdline-tools/tmp && cd /opt/android-sdk/cmdline-tools/tmp && jar xf /downloads/${CMDLINE_TOOLS.file} && rm -rf ../latest && mv cmdline-tools ../latest && cd .. && rmdir tmp && chmod +x latest/bin/*`,
    );
  }

  if (!existsSync(path.join(sdk, "licenses", "android-sdk-license"))) {
    if (!args.acceptLicenses)
      fail(
        "The Android SDK licenses are not accepted in this cache yet. Read them (sdkmanager " +
          "--licenses) and run this script again with --accept-sdk-licenses.",
      );
    step("Accepting the Android SDK licenses");
    await inImage(args.cache, [], "yes | sdkmanager --licenses > /dev/null");
  }

  if (
    !existsSync(path.join(sdk, "platforms", PLATFORM)) ||
    !existsSync(path.join(sdk, "build-tools", BUILD_TOOLS))
  ) {
    step(`SDK packages: ${SDK_PACKAGES.join(", ")}`);
    await inImage(
      args.cache,
      [],
      `sdkmanager --install ${SDK_PACKAGES.map((p) => `"${p}"`).join(" ")}`,
    );
  }

  const keystore = path.join(args.signing, "kal-release.jks");
  const keystoreProps = path.join(args.signing, "keystore.properties");
  if (!existsSync(keystore)) {
    if (existsSync(keystoreProps))
      fail(`${keystoreProps} exists but kal-release.jks does not. Restore the key from a backup.`);
    step("Release key (first run)");
    // PKCS12 keys use the store password; one random password for both.
    const password = crypto.randomBytes(24).toString("base64url");
    await writeFile(
      keystoreProps,
      `# Made by scripts/android-build.mjs. Keep it private and backed up with kal-release.jks.\n` +
        `storeFile=kal-release.jks\nstorePassword=${password}\nkeyAlias=kal\nkeyPassword=${password}\n`,
      { mode: 0o600 },
    );
    await inImage(
      args.cache,
      [`${args.signing}:/signing`],
      "keytool -genkeypair -keystore /signing/kal-release.jks -storetype PKCS12 -alias kal " +
        "-keyalg RSA -keysize 4096 -validity 10000 -dname CN=Kal " +
        "-storepass:env KAL_KEY_PASSWORD -keypass:env KAL_KEY_PASSWORD",
      { secrets: { KAL_KEY_PASSWORD: password } },
    ).catch(async (error) => {
      await rm(keystoreProps, { force: true });
      throw error;
    });
    console.log(`Made ${keystore} and ${keystoreProps}.`);
  } else if (!existsSync(keystoreProps)) {
    fail(`${keystoreProps} is missing next to kal-release.jks.`);
  }

  step(`Build (${props["kal.appId"]}, version ${props["kal.versionName"] ?? "1.0"})`);
  await inImage(
    args.cache,
    [
      `${androidDir}:/work`,
      `${args.properties}:/config/kal.properties:ro`,
      `${args.signing}:/signing:ro`,
    ],
    "sh ./gradlew --console=plain -Pkal.properties=/config/kal.properties " +
      "-Pkal.signing=/signing/keystore.properties clean testDebugUnitTest assembleRelease",
  );

  const apk = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!existsSync(apk)) fail(`No signed APK at ${apk}.`);

  step("Verify");
  const tools = `/opt/android-sdk/build-tools/${BUILD_TOOLS}`;
  const apkInImage = "/work/app/build/outputs/apk/release/app-release.apk";
  const verified = await inImage(
    args.cache,
    [`${androidDir}:/work:ro`],
    `${tools}/apksigner verify --verbose --print-certs ${apkInImage}`,
    { capture: true },
  );
  // "V2 Signer: certificate SHA-256 digest: ..." (or "Signer #1 ..." in older apksigner).
  const certs = [
    ...verified.matchAll(/Signer(?: #\d+)?: certificate SHA-256 digest: ([0-9a-f]{64})/gi),
  ].map((m) => m[1].toLowerCase());
  const certHex = new Set(certs).size === 1 ? certs[0] : null;
  if (!/^Verifies$/m.test(verified) || !/Number of signers: 1\b/.test(verified) || !certHex)
    fail(`apksigner did not verify the APK with exactly one signer:\n${verified}`);
  const badging = await inImage(
    args.cache,
    [`${androidDir}:/work:ro`],
    `${tools}/aapt2 dump badging ${apkInImage}`,
    { capture: true },
  );
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/.exec(badging);
  const minSdk = Number(/minSdkVersion:'(\d+)'/.exec(badging)?.[1]);
  const targetSdk = Number(/targetSdkVersion:'(\d+)'/.exec(badging)?.[1]);
  const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]);
  if (!pkg || !minSdk || !targetSdk) fail(`aapt2 could not read the APK:\n${badging}`);

  const target = path.join(args.out, "kal.apk");
  await copyFile(apk, target);
  const size = (await stat(target)).size;
  const sha256 = await sha256File(target);
  const version = {
    versionName: pkg[3],
    versionCode: Number(pkg[2]),
    size,
    sha256,
    minSdk,
    targetSdk,
  };
  await writeFile(path.join(args.out, "version.json"), `${JSON.stringify(version, null, 2)}\n`);

  const fingerprint = certHex.toUpperCase().match(/../g).join(":");
  step("Done");
  console.log(`Package       ${pkg[1]}`);
  console.log(`Version       ${version.versionName} (${version.versionCode})`);
  console.log(`Size          ${size} bytes`);
  console.log(`SDK           min ${minSdk}, target ${targetSdk}`);
  console.log(`Certificate   SHA-256 ${fingerprint}`);
  console.log(`Permissions   ${permissions.join("\n              ")}`);
  console.log(`Written       ${target} and version.json`);
  console.log(
    "\nOn the server: copy both files to deploy/android, and set ANDROID_APP_ID to the package " +
      "and ANDROID_CERT_SHA256 to the certificate SHA-256 above in site.env.",
  );
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
