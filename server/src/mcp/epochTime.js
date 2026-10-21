/** Seconds since the Unix epoch (the unit OAuth artefacts use). */
export default function epochTime(date = Date.now()) {
  return Math.floor(date / 1000);
}
