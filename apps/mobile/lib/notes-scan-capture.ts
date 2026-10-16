// The native half of "Scan notes": the camera, the photo library, and getting
// a photo ready to send (upright, JPEG, no bigger than the model reads). The
// rules that need no native module are in lib/notes-scan.ts.
//
// Photos are the writer's private notes. They are kept in the app's cache
// only while the screen is open, sent once, and removed (`discardPhotos`).

import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { ciciro } from "./api";
import type { ScanReadingResponse } from "./api/types";
import {
  SCAN_JPEG_QUALITY,
  SCAN_PAGES_MAX,
  scanResizeTarget,
  type ScanPageDraft,
} from "./notes-scan";

export type PickedPhoto = { uri: string; width: number; height: number };

export type CaptureResult =
  | { kind: "photos"; photos: PickedPhoto[] }
  | { kind: "cancelled" }
  /** Camera access is off. `canAskAgain` false means only Settings can turn it on. */
  | { kind: "denied"; canAskAgain: boolean }
  /** This device has no camera to open (a simulator, some tablets). */
  | { kind: "unavailable" };

function photosFrom(result: ImagePicker.ImagePickerResult): CaptureResult {
  if (result.canceled || result.assets.length === 0) return { kind: "cancelled" };
  return {
    kind: "photos",
    photos: result.assets.map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height })),
  };
}

/** Open the camera for one photo, asking for permission the first time. */
export async function takePhoto(): Promise<CaptureResult> {
  let permission = await ImagePicker.getCameraPermissionsAsync();
  if (!permission.granted) {
    if (!permission.canAskAgain) return { kind: "denied", canAskAgain: false };
    permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: "denied", canAskAgain: permission.canAskAgain };
  }
  try {
    return photosFrom(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false }));
  } catch {
    // The picker throws when there is no camera to open.
    return { kind: "unavailable" };
  }
}

/** Pick up to `limit` photos from the library, in the order they were tapped. Needs no permission: the system picker hands over only what is chosen. */
export async function pickPhotos(limit: number): Promise<CaptureResult> {
  const remaining = Math.max(1, Math.min(SCAN_PAGES_MAX, limit));
  return photosFrom(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      orderedSelection: true,
      quality: 1,
      exif: false,
    })
  );
}

/** A photo as an upright JPEG no bigger than `SCAN_IMAGE_EDGE` on its long side. HEIC and PNG become JPEG here. */
export async function prepareScanPhoto(photo: PickedPhoto): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  const target = scanResizeTarget(photo.width, photo.height);
  if (target) context.resize({ width: target.width });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: SCAN_JPEG_QUALITY });
  return saved.uri;
}

/** Remove photo files from the cache. Best effort: a file already gone is not a problem. */
export function discardPhotos(uris: readonly string[]): void {
  for (const uri of uris) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Not ours to remove, or already gone.
    }
  }
}

/**
 * Send the photos to be read. They are resized and re-encoded first, in
 * order, and the resized copies are removed once the request has settled.
 * Rejects with the API's error, which `scanFailure` turns into something to say.
 */
export async function readScanPages(
  projectId: string,
  pages: readonly ScanPageDraft[],
  signal?: AbortSignal
): Promise<ScanReadingResponse> {
  const prepared: string[] = [];
  try {
    for (const page of pages) prepared.push(await prepareScanPhoto(page));
    const form = new FormData();
    // The app's fetch (expo/fetch) cannot send React Native's `{ uri, name, type }` file
    // descriptor ("Unsupported FormDataPart"); a `File` reads its own bytes.
    prepared.forEach((uri, index) => form.append("page", new File(uri) as unknown as Blob, `page-${index + 1}.jpg`));
    return await ciciro.projects.scanNotes.read(projectId, form, { signal });
  } finally {
    discardPhotos(prepared);
  }
}
