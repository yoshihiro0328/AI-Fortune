// Read process environment only; never load a credential file or print a value.
import { productionIssues } from "../../src/lib/production/config.ts";
const issues = productionIssues();
console.log(
  JSON.stringify({
    ready: issues.length === 0,
    issues,
    valuesPrinted: false,
    externalChecks: false,
  }),
);
process.exitCode = issues.length ? 1 : 0;
