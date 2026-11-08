// The README's quickstart, as it is there (test/readme.test.ts keeps them
// equal): `npm run build`, then `node examples/quickstart.mjs leaf.jpg`
// with PETIOLE_API_KEY set, and PETIOLE_BASE_URL for a staging key.
import { Petiole } from "@petiole/sdk";
import { imageFromPath } from "@petiole/sdk/node";

const petiole = new Petiole(); // the key from PETIOLE_API_KEY
const photo = await imageFromPath(process.argv[2] ?? "leaf.jpg");

// What a model finds: the leaf detector's boxes, each with its confidence.
const found = await petiole.models.predict("leaf-detector", photo);
console.log(`Leaves found: ${found.detections.length}, in ${found.durationMs} ms`);

// Their outlines: SAM 2.1 on the detector's boxes.
const outlined = await petiole.models.predict("sam2-small", photo, {
  boxes: found.detections.slice(0, 50).map((leaf) => leaf.bbox),
});
console.log(`Outlined: ${outlined.detections.length}, the first in ${outlined.detections[0]?.polygons?.[0]?.length} points`);

// What a workflow measures: leaf area in cm², from the calibration pad.
const measured = await petiole.analyze(photo, { workflow: "leaf_area_v1" });
if (measured.status === "succeeded") {
  for (const leaf of measured.result?.objects ?? []) {
    console.log(`${leaf.objectId}: ${leaf.properties.area_cm2} cm²`);
  }
} else {
  console.log(`Not measured: ${measured.reason} (${measured.code})`);
}
