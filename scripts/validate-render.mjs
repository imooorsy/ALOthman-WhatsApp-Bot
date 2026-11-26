import fs from "node:fs/promises";
import YAML from "yaml";
import Ajv from "ajv/dist/2020.js";
async function main() {
  const blueprint = YAML.parse(
    await fs.readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    { uniqueKeys: true },
  );
  const response = await fetch("https://render.com/schema/render.yaml.json", {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error("Unable to download the official Render Blueprint schema");
  const schema = await response.json();
  const validate = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
  }).compile(schema);
  if (!validate(blueprint)) {
    for (const error of validate.errors || [])
      console.error(`${error.instancePath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Render Blueprint passes the official JSON Schema. Account, repository, DNS and provisioning checks still require Render.",
  );
}
main().catch((error) => {
  console.error(
    "Render validation could not complete: " +
      (error instanceof Error ? error.message : "schema or network error"),
  );
  process.exitCode = 1;
});
