// The README's quickstart, as it is there (test/readme.test.ts keeps them
// equal): `npm run build`, then `node examples/quickstart.mjs leaf.jpg`
// with PETIOLE_API_KEY set, and PETIOLE_BASE_URL for a staging key.
import { Petiole } from "@petiole/sdk";
import { imageFromPath } from "@petiole/sdk/node";

const petiole = new Petiole(); // reads PETIOLE_API_KEY
const photo = await imageFromPath(process.argv[2] ?? "leaf.jpg");

// 1. Detect leaves: bounding boxes with confidence scores.
const found = await petiole.models.predict("leaf-detector", photo);
console.log(`Leaves found: ${found.detections.length} (${found.durationMs} ms)`);

// 2. Outline them: SAM 2.1 segments the detected boxes.
const outlined = await petiole.models.predict("sam2-small", photo, {
  boxes: found.detections.slice(0, 50).map((leaf) => leaf.bbox),
});
console.log(`Outlined: ${outlined.detections.length}`);

// 3. Measure them: leaf area in cm², calibrated by the pad.
const measured = await petiole.analyze(photo, { workflow: "leaf_area_v1" });

if (measured.status === "succeeded") {
  for (const leaf of measured.result?.objects ?? []) {
    console.log(`${leaf.objectId}: ${leaf.properties.area_cm2} cm²`);
  }
} else {
  console.log(`Not measured: ${measured.reason} (${measured.code})`);
}
