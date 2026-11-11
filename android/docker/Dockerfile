# Build environment of the Kal Android app (scripts/android-build.mjs builds and runs it). Only the
# JDK is in the image: the Android SDK, the Gradle distribution and Gradle's caches are bind mounts
# of a cache folder on the host, so the image stays small and nothing large lands in Docker's own
# data folder. The base image is Docker Hub's official Eclipse Temurin JDK 21, pinned by digest.
FROM eclipse-temurin:21-jdk-noble@sha256:114cabb73033ca4ce7ceec3deb62396bc1b716282bae051ed3c1d82e38fcab2d

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    ANDROID_USER_HOME=/cache/android-user \
    GRADLE_USER_HOME=/cache/gradle \
    GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.vfs.watch=false" \
    PATH="/opt/android-sdk/cmdline-tools/latest/bin:${PATH}"

WORKDIR /work
