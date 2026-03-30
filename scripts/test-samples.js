const fs = require("node:fs/promises");
const path = require("node:path");

const { fileToDataPayload, parseCircuitImage } = require("../lib/circuit-parser");

const samples = [
  { id: "q1", file: "public/题目1.jpg" },
  { id: "q2", file: "public/题目2.jpg" },
  { id: "q3", file: "public/题目3.png" }
];

async function main() {
  const outputDir = path.join(process.cwd(), "generated-scenes");
  await fs.mkdir(outputDir, { recursive: true });

  for (const sample of samples) {
    const filePath = path.join(process.cwd(), sample.file);
    const payload = await fileToDataPayload(filePath);
    const result = await parseCircuitImage(payload);
    const outputPath = path.join(outputDir, `${sample.id}.scene.json`);
    await fs.writeFile(outputPath, JSON.stringify(result.scene, null, 2), "utf8");
    console.log(
      [
        sample.id,
        `components=${result.scene.components.length}`,
        `wires=${result.scene.wires.length}`,
        `labels=${result.scene.labels.length}`,
        `tokens=${result.usage?.total_tokens ?? "--"}`,
        outputPath
      ].join(" | ")
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
