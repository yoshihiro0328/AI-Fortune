import { start, stop } from "./runtime.mjs";
const [action, destination] = process.argv.slice(2);
if (!["start", "stop", "restart"].includes(action) || !destination)
  throw Error(
    "USAGE: control.mjs start|stop|restart absolute-review-directory",
  );
if (action !== "start") await stop(destination);
if (action !== "stop") console.log(JSON.stringify(await start(destination)));
