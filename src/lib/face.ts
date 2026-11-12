// Face recognition runs on the device. The library and its models (about 7 MB) are
// loaded only when a camera screen opens, and cached by the browser after that.
type FaceApi = typeof import("@vladmandic/face-api");

let loading: Promise<FaceApi> | null = null;

export function loadFace(): Promise<FaceApi> {
  loading ??= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
    return faceapi;
  })().catch((e) => {
    loading = null; // allow a retry on the next attempt
    throw e;
  });
  return loading;
}

/** Returns the 128-number face template for the single face in the image, or null if no face is found. */
export async function describeFace(input: HTMLVideoElement | HTMLCanvasElement): Promise<number[] | null> {
  const faceapi = await loadFace();
  const result = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result ? Array.from(result.descriptor) : null;
}

export function averageDescriptors(list: number[][]): number[] {
  return list[0].map((_, i) => list.reduce((s, d) => s + d[i], 0) / list.length);
}
